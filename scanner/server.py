from __future__ import annotations

import os
from typing import Any

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from auth import require_auth
from models import (
    CreateSessionRequest,
    DeleteSessionResponse,
    FinishSessionResponse,
    FrameScanResult,
    HealthResponse,
    ScanSessionSnapshot,
    SpreadMode,
)
from ocr_engine import get_ocr_backend_name
from session_manager import SessionManager

DEFAULT_ALLOWED_ORIGINS = (
    "https://bookhighlighter.juanevillam.com,"
    "http://localhost:5173,"
    "http://127.0.0.1:5173"
)
MAX_FRAME_BYTES = 16 * 1024 * 1024  # 16 MB in-RAM frame cap


def _parse_allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or ["*"]


def _parse_bool_form(value: str | bool | None) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def create_app(session_manager: SessionManager | None = None) -> FastAPI:
    manager = session_manager or SessionManager()

    application = FastAPI(
        title="Book Highlighter Scanner API",
        version="0.1.0",
        description="Zero-storage in-RAM physical book page & sticky-grammar scanner.",
    )
    application.state.session_manager = manager

    origins = _parse_allowed_origins()
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials= origins != ["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(ok=True, ocrBackend=get_ocr_backend_name())

    @application.post("/sessions", response_model=ScanSessionSnapshot)
    async def create_session(
        payload: CreateSessionRequest | None = Body(default=None),
        _claims: dict[str, Any] = Depends(require_auth),
    ) -> ScanSessionSnapshot:
        book_title = payload.bookTitle if payload is not None else None
        return manager.create_session(book_title=book_title)

    @application.get("/sessions/{session_id}", response_model=ScanSessionSnapshot)
    async def get_session(
        session_id: str,
        _claims: dict[str, Any] = Depends(require_auth),
    ) -> ScanSessionSnapshot:
        sess = manager.get_session(session_id)
        if sess is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Scan session not found or expired.",
            )
        return sess.to_snapshot()

    @application.post(
        "/sessions/{session_id}/frame",
        response_model=FrameScanResult,
    )
    async def scan_frame(
        session_id: str,
        frame: UploadFile = File(...),
        spreadMode: SpreadMode = Form(default="auto"),
        force: str = Form(default="false"),
        _claims: dict[str, Any] = Depends(require_auth),
    ) -> FrameScanResult:
        try:
            raw_bytes = await frame.read(MAX_FRAME_BYTES + 1)
        finally:
            await frame.close()

        if not raw_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded frame is empty.",
            )
        if len(raw_bytes) > MAX_FRAME_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Uploaded frame exceeds 16 MB limit.",
            )

        force_flag = _parse_bool_form(force)

        try:
            result = await run_in_threadpool(
                manager.process_frame,
                session_id,
                raw_bytes,
                spreadMode,
                force_flag,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc
        finally:
            # Drop reference immediately so frame bytes are eligible for GC right away.
            del raw_bytes

        if result is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Scan session not found or expired.",
            )
        return result

    @application.post(
        "/sessions/{session_id}/finish",
        response_model=FinishSessionResponse,
    )
    async def finish_session(
        session_id: str,
        _claims: dict[str, Any] = Depends(require_auth),
    ) -> FinishSessionResponse:
        snapshot = manager.finish_session(session_id)
        if snapshot is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Scan session not found or expired.",
            )
        return FinishSessionResponse(snapshot=snapshot)

    @application.delete(
        "/sessions/{session_id}",
        response_model=DeleteSessionResponse,
    )
    async def delete_session(
        session_id: str,
        _claims: dict[str, Any] = Depends(require_auth),
    ) -> DeleteSessionResponse:
        manager.delete_session(session_id)
        return DeleteSessionResponse(deleted=True)

    return application


app = create_app()


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8080"))
    uvicorn.run("server:app", host="0.0.0.0", port=port)
