from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


OcrBackendKind = Literal["gemini", "rapidocr", "hybrid"]
SpreadMode = Literal["auto", "single", "double"]
PageSide = Literal["single", "left", "right"]
MarkerKind = Literal["L", "bar"]
HighlightKind = Literal["L", "range"]
PageAction = Literal[
    "skipped",
    "toc",
    "chapter-start",
    "highlight-L",
    "range-open",
    "range-continue",
    "range-close",
]


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool = True
    ocrBackend: OcrBackendKind


class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    bookTitle: str | None = None


class HighlightItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    page: str | None = None
    text: str
    kind: HighlightKind


class ChapterSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    pages: str
    highlights: list[HighlightItem] = Field(default_factory=list)


class OpenRangeState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: bool = False
    startPage: int | None = None
    lastPage: int | None = None
    previewText: str = ""


class ScanSessionSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sessionId: str
    pagesScanned: int = 0
    pagesSkipped: int = 0
    currentChapter: str = ""
    openRange: OpenRangeState = Field(default_factory=OpenRangeState)
    warnings: list[str] = Field(default_factory=list)
    chapters: list[ChapterSnapshot] = Field(default_factory=list)


class DetectedMarker(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: MarkerKind
    yNorm: float
    xNorm: float
    bbox: tuple[float, float, float, float]


class DetectedPageResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pageNumber: int | None = None
    side: PageSide = "single"
    action: PageAction = "skipped"
    markers: list[DetectedMarker] = Field(default_factory=list)
    extractedCount: int = 0


class FrameScanResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: bool
    reason: str | None = None
    detectedPages: list[DetectedPageResult] = Field(default_factory=list)
    snapshot: ScanSessionSnapshot


class FinishSessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snapshot: ScanSessionSnapshot


class DeleteSessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deleted: bool = True
