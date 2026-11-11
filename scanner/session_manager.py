from __future__ import annotations

import re
import threading
import time
import uuid
from dataclasses import dataclass, field

from models import (
    ChapterSnapshot,
    DetectedPageResult,
    FrameScanResult,
    HighlightItem,
    HighlightKind,
    OpenRangeState,
    PageAction,
    ScanSessionSnapshot,
    SpreadMode,
)
from ocr_engine import (
    HybridOcrEngine,
    SliceSpec,
    looks_like_structural_page_fast,
    merge_range_chunks,
)
from sticky_detector import (
    FrameSignature,
    compute_frame_signature,
    decode_frame_bytes,
    detect_stickies,
    is_book_page,
    is_duplicate_frame,
    is_frame_blurry,
    split_spread,
)

SESSION_TTL_SECONDS = 30 * 60  # 30 minutes
MAX_CONCURRENT_SESSIONS = 50
DEFAULT_FALLBACK_CHAPTER = "Sin capítulo"


def format_range_page_label(start_page: int | None, end_page: int | None) -> str | None:
    if start_page is not None and end_page is not None:
        if end_page != start_page:
            lo, hi = (start_page, end_page) if start_page < end_page else (end_page, start_page)
            return f"{lo}–{hi}"
        return str(start_page)
    if start_page is not None:
        return str(start_page)
    if end_page is not None:
        return str(end_page)
    return None


def format_chapter_pages(highlights: list[HighlightItem]) -> str:
    """Format chapter page summary cleanly in Spanish: '23', '23 y 38', '523, 538 y 543'."""
    unique_pages: list[str] = []
    seen: set[str] = set()
    for hl in highlights:
        if hl.page and hl.page.strip():
            token = hl.page.strip()
            if token not in seen:
                seen.add(token)
                unique_pages.append(token)

    def _sort_key(page_token: str) -> tuple[int, str]:
        m = re.match(r"^\s*(\d+)", page_token)
        return (int(m.group(1)) if m else 10**9, page_token)

    unique_pages.sort(key=_sort_key)

    if not unique_pages:
        return ""
    if len(unique_pages) == 1:
        return unique_pages[0]
    if len(unique_pages) == 2:
        return f"{unique_pages[0]} y {unique_pages[1]}"
    return f"{', '.join(unique_pages[:-1])} y {unique_pages[-1]}"


@dataclass(slots=True)
class _OpenRangeBuffer:
    active: bool = False
    start_page: int | None = None
    last_page: int | None = None
    chapter_name: str = ""
    chunks: list[str] = field(default_factory=list)

    def reset(self) -> None:
        self.active = False
        self.start_page = None
        self.last_page = None
        self.chapter_name = ""
        self.chunks.clear()

    def preview_text(self, max_chars: int = 200) -> str:
        merged = merge_range_chunks(self.chunks)
        if len(merged) <= max_chars:
            return merged
        return merged[: max_chars - 1].rstrip() + "…"

    def to_model(self) -> OpenRangeState:
        if not self.active:
            return OpenRangeState()
        return OpenRangeState(
            active=True,
            startPage=self.start_page,
            lastPage=self.last_page,
            previewText=self.preview_text(),
        )


@dataclass(slots=True)
class _ChapterBucket:
    id: str
    name: str
    highlights: list[HighlightItem] = field(default_factory=list)

    def to_model(self) -> ChapterSnapshot:
        return ChapterSnapshot(
            id=self.id,
            name=self.name,
            pages=format_chapter_pages(self.highlights),
            highlights=list(self.highlights),
        )


@dataclass(slots=True)
class ScanSession:
    session_id: str
    book_title: str | None = None
    created_at: float = field(default_factory=time.monotonic)
    updated_at: float = field(default_factory=time.monotonic)
    pages_scanned: int = 0
    pages_skipped: int = 0
    current_chapter: str = ""
    toc_map: dict[int, str] = field(default_factory=dict)
    seen_pages: set[int] = field(default_factory=set)
    warnings: list[str] = field(default_factory=list)
    chapter_buckets: list[_ChapterBucket] = field(default_factory=list)
    open_range: _OpenRangeBuffer = field(default_factory=_OpenRangeBuffer)
    last_frame_sig: FrameSignature | None = None
    _next_chapter_seq: int = 1
    _next_highlight_seq: int = 1

    def touch(self) -> None:
        self.updated_at = time.monotonic()

    def effective_chapter_name(self) -> str:
        if self.current_chapter.strip():
            return self.current_chapter.strip()
        if self.book_title and self.book_title.strip():
            return self.book_title.strip()
        return DEFAULT_FALLBACK_CHAPTER

    def add_warning(self, message: str) -> None:
        if message not in self.warnings:
            self.warnings.append(message)

    def check_open_range_gap(self, next_page: int | None) -> None:
        if not self.open_range.active:
            return
        last_p = self.open_range.last_page
        if last_p is None or next_page is None:
            return
        if next_page > last_p + 1:
            miss_start = last_p + 1
            miss_end = next_page - 1
            origin_p = (
                self.open_range.start_page
                if self.open_range.start_page is not None
                else last_p
            )
            if miss_start == miss_end:
                self.add_warning(
                    f"Falta la página {miss_start} del rango abierto en pág. {origin_p}"
                )
            else:
                self.add_warning(
                    f"Faltan las páginas {miss_start}–{miss_end} del rango abierto en pág. {origin_p}"
                )

    def add_highlight(
        self,
        *,
        chapter_name: str,
        page: str | None,
        text: str,
        kind: HighlightKind,
    ) -> HighlightItem:
        clean_name = chapter_name.strip() or self.effective_chapter_name()
        bucket = next((b for b in self.chapter_buckets if b.name == clean_name), None)
        if bucket is None:
            bucket = _ChapterBucket(
                id=f"ch-{self._next_chapter_seq}",
                name=clean_name,
            )
            self._next_chapter_seq += 1
            self.chapter_buckets.append(bucket)

        item = HighlightItem(
            id=f"hl-{self._next_highlight_seq}",
            page=page,
            text=text.strip(),
            kind=kind,
        )
        self._next_highlight_seq += 1
        bucket.highlights.append(item)
        return item

    def flush_open_range(self) -> bool:
        if not self.open_range.active:
            return False
        merged = merge_range_chunks(self.open_range.chunks)
        page_label = format_range_page_label(
            self.open_range.start_page, self.open_range.last_page
        )
        target_chapter = self.open_range.chapter_name or self.effective_chapter_name()
        self.open_range.reset()
        if merged:
            self.add_highlight(
                chapter_name=target_chapter,
                page=page_label,
                text=merged,
                kind="range",
            )
            return True
        return False

    def to_snapshot(self) -> ScanSessionSnapshot:
        return ScanSessionSnapshot(
            sessionId=self.session_id,
            pagesScanned=self.pages_scanned,
            pagesSkipped=self.pages_skipped,
            currentChapter=self.current_chapter,
            openRange=self.open_range.to_model(),
            warnings=list(self.warnings),
            chapters=[b.to_model() for b in self.chapter_buckets],
        )


class SessionManager:
    """In-RAM TTL session store (30 min expiry, max 50 sessions, zero disk writes)."""

    def __init__(
        self,
        ocr_engine: HybridOcrEngine | None = None,
        ttl_seconds: float = SESSION_TTL_SECONDS,
        max_sessions: int = MAX_CONCURRENT_SESSIONS,
    ) -> None:
        self._ocr = ocr_engine or HybridOcrEngine()
        self._ttl_seconds = ttl_seconds
        self._max_sessions = max_sessions
        self._sessions: dict[str, ScanSession] = {}
        self._lock = threading.RLock()

    @property
    def ocr_engine(self) -> HybridOcrEngine:
        return self._ocr

    def _evict_expired_or_overflow_locked(self) -> None:
        now = time.monotonic()
        expired_ids = [
            sid
            for sid, sess in self._sessions.items()
            if (now - sess.updated_at) > self._ttl_seconds
        ]
        for sid in expired_ids:
            self._sessions.pop(sid, None)

        while len(self._sessions) >= self._max_sessions:
            oldest_sid = min(
                self._sessions, key=lambda sid: self._sessions[sid].updated_at
            )
            self._sessions.pop(oldest_sid, None)

    def create_session(self, book_title: str | None = None) -> ScanSessionSnapshot:
        with self._lock:
            self._evict_expired_or_overflow_locked()
            session_id = uuid.uuid4().hex[:16]
            clean_title = book_title.strip() if book_title and book_title.strip() else None
            session = ScanSession(session_id=session_id, book_title=clean_title)
            self._sessions[session_id] = session
            return session.to_snapshot()

    def get_session(self, session_id: str) -> ScanSession | None:
        with self._lock:
            now = time.monotonic()
            sess = self._sessions.get(session_id)
            if sess is None:
                return None
            if (now - sess.updated_at) > self._ttl_seconds:
                self._sessions.pop(session_id, None)
                return None
            sess.touch()
            return sess

    def finish_session(self, session_id: str) -> ScanSessionSnapshot | None:
        with self._lock:
            sess = self.get_session(session_id)
            if sess is None:
                return None
            sess.flush_open_range()
            sess.touch()
            return sess.to_snapshot()

    def delete_session(self, session_id: str) -> bool:
        with self._lock:
            existed = self._sessions.pop(session_id, None) is not None
            return existed

    def process_frame(
        self,
        session_id: str,
        raw_bytes: bytes,
        spread_mode: SpreadMode = "auto",
        force: bool = False,
    ) -> FrameScanResult | None:
        sess = self.get_session(session_id)
        if sess is None:
            return None

        bgr = decode_frame_bytes(raw_bytes)

        blurry, _ = is_frame_blurry(bgr)
        if blurry and not force:
            with self._lock:
                sess.touch()
                return FrameScanResult(
                    accepted=False,
                    reason="blurry",
                    detectedPages=[],
                    snapshot=sess.to_snapshot(),
                )

        split_pages = split_spread(bgr, spread_mode=spread_mode)
        if not any(is_book_page(page_bgr) for _, page_bgr in split_pages):
            with self._lock:
                sess.touch()
                return FrameScanResult(
                    accepted=False,
                    reason="no-page",
                    detectedPages=[],
                    snapshot=sess.to_snapshot(),
                )

        sig = compute_frame_signature(bgr)
        with self._lock:
            if not force and is_duplicate_frame(sig, sess.last_frame_sig):
                sess.touch()
                return FrameScanResult(
                    accepted=False,
                    reason="duplicate",
                    detectedPages=[],
                    snapshot=sess.to_snapshot(),
                )
            sess.last_frame_sig = sig

        detected_pages: list[DetectedPageResult] = []

        for side, page_bgr in split_pages:
            page_res = self._process_single_page(sess, side, page_bgr)
            detected_pages.append(page_res)

        with self._lock:
            sess.touch()
            snapshot = sess.to_snapshot()

        return FrameScanResult(
            accepted=True,
            reason=None,
            detectedPages=detected_pages,
            snapshot=snapshot,
        )

    def _process_single_page(
        self,
        sess: ScanSession,
        side: str,
        page_bgr,
    ) -> DetectedPageResult:
        markers = detect_stickies(page_bgr)

        with self._lock:
            sess.pages_scanned += 1
            open_range_active = sess.open_range.active

        # Stage 1 fast OpenCV skip for plain unmarked prose pages when no range is open.
        if not markers and not open_range_active:
            if not looks_like_structural_page_fast(page_bgr):
                with self._lock:
                    sess.pages_skipped += 1
                return DetectedPageResult(
                    pageNumber=None,
                    side=side,  # type: ignore[arg-type]
                    action="skipped",
                    markers=[],
                    extractedCount=0,
                )

        ops = _plan_page_operations(markers, open_range_active)
        slice_specs = [spec for _, spec in ops]
        analysis = self._ocr.analyze_page(page_bgr, slice_specs)

        with self._lock:
            pnum = analysis.page_number
            if pnum is not None:
                sess.seen_pages.add(pnum)

            if analysis.is_toc and analysis.toc_entries:
                sess.toc_map.update(analysis.toc_entries)
                if not ops:
                    return DetectedPageResult(
                        pageNumber=pnum,
                        side=side,  # type: ignore[arg-type]
                        action="toc",
                        markers=markers,
                        extractedCount=0,
                    )

            started_chapter = False
            if analysis.chapter_title:
                sess.current_chapter = analysis.chapter_title
                if pnum is not None:
                    sess.toc_map.setdefault(pnum, analysis.chapter_title)
                started_chapter = True
            elif pnum is not None and sess.toc_map:
                prior_pages = [tp for tp in sess.toc_map if tp <= pnum]
                if prior_pages:
                    sess.current_chapter = sess.toc_map[max(prior_pages)]

            if not ops:
                if started_chapter:
                    return DetectedPageResult(
                        pageNumber=pnum,
                        side=side,  # type: ignore[arg-type]
                        action="chapter-start",
                        markers=markers,
                        extractedCount=0,
                    )
                sess.pages_skipped += 1
                return DetectedPageResult(
                    pageNumber=pnum,
                    side=side,  # type: ignore[arg-type]
                    action="skipped",
                    markers=markers,
                    extractedCount=0,
                )

            extracted_count = 0
            primary_action: PageAction = "skipped"

            for (op_kind, _), raw_slice in zip(ops, analysis.extracted_slices):
                clean_text = raw_slice.strip()

                if op_kind == "L":
                    if clean_text:
                        sess.add_highlight(
                            chapter_name=sess.effective_chapter_name(),
                            page=str(pnum) if pnum is not None else None,
                            text=clean_text,
                            kind="L",
                        )
                        extracted_count += 1
                    primary_action = "highlight-L"

                elif op_kind == "range-intra":
                    if clean_text:
                        sess.add_highlight(
                            chapter_name=sess.effective_chapter_name(),
                            page=str(pnum) if pnum is not None else None,
                            text=clean_text,
                            kind="range",
                        )
                        extracted_count += 1
                    primary_action = "range-close"

                elif op_kind == "range-open":
                    sess.open_range.active = True
                    sess.open_range.start_page = pnum
                    sess.open_range.last_page = pnum
                    sess.open_range.chapter_name = sess.effective_chapter_name()
                    sess.open_range.chunks = [clean_text] if clean_text else []
                    primary_action = "range-open"

                elif op_kind == "range-continue":
                    sess.check_open_range_gap(pnum)
                    if pnum is not None:
                        sess.open_range.last_page = pnum
                    if clean_text:
                        sess.open_range.chunks.append(clean_text)
                    primary_action = "range-continue"

                elif op_kind == "range-close":
                    sess.check_open_range_gap(pnum)
                    if clean_text:
                        sess.open_range.chunks.append(clean_text)
                    end_p = pnum if pnum is not None else sess.open_range.last_page
                    page_label = format_range_page_label(
                        sess.open_range.start_page, end_p
                    )
                    target_chapter = (
                        sess.open_range.chapter_name or sess.effective_chapter_name()
                    )
                    merged = merge_range_chunks(sess.open_range.chunks)
                    sess.open_range.reset()
                    if merged:
                        sess.add_highlight(
                            chapter_name=target_chapter,
                            page=page_label,
                            text=merged,
                            kind="range",
                        )
                        extracted_count += 1
                    primary_action = "range-close"

            return DetectedPageResult(
                pageNumber=pnum,
                side=side,  # type: ignore[arg-type]
                action=primary_action,
                markers=markers,
                extractedCount=extracted_count,
            )


def _plan_page_operations(
    markers,
    open_range_active: bool,
) -> list[tuple[str, SliceSpec]]:
    l_markers = sorted((m for m in markers if m.kind == "L"), key=lambda m: m.yNorm)
    bar_markers = sorted((m for m in markers if m.kind == "bar"), key=lambda m: m.yNorm)

    ops: list[tuple[str, SliceSpec]] = [
        ("L", SliceSpec(mode="paragraph_at_y", y_norm=m.yNorm)) for m in l_markers
    ]

    if open_range_active:
        if not bar_markers:
            if not l_markers:
                ops.append(
                    (
                        "range-continue",
                        SliceSpec(mode="y_range", y_start_norm=0.0, y_end_norm=1.0),
                    )
                )
        elif len(bar_markers) == 1:
            ops.append(
                (
                    "range-close",
                    SliceSpec(
                        mode="y_range",
                        y_start_norm=0.0,
                        y_end_norm=bar_markers[0].yNorm,
                    ),
                )
            )
        else:
            ops.append(
                (
                    "range-close",
                    SliceSpec(
                        mode="y_range",
                        y_start_norm=0.0,
                        y_end_norm=bar_markers[0].yNorm,
                    ),
                )
            )
            rest = bar_markers[1:]
            idx = 0
            while idx + 1 < len(rest):
                ops.append(
                    (
                        "range-intra",
                        SliceSpec(
                            mode="y_range",
                            y_start_norm=rest[idx].yNorm,
                            y_end_norm=rest[idx + 1].yNorm,
                        ),
                    )
                )
                idx += 2
            if idx < len(rest):
                ops.append(
                    (
                        "range-open",
                        SliceSpec(
                            mode="y_range",
                            y_start_norm=rest[idx].yNorm,
                            y_end_norm=1.0,
                        ),
                    )
                )
    else:
        if len(bar_markers) == 1:
            ops.append(
                (
                    "range-open",
                    SliceSpec(
                        mode="y_range",
                        y_start_norm=bar_markers[0].yNorm,
                        y_end_norm=1.0,
                    ),
                )
            )
        elif len(bar_markers) >= 2:
            idx = 0
            while idx + 1 < len(bar_markers):
                ops.append(
                    (
                        "range-intra",
                        SliceSpec(
                            mode="y_range",
                            y_start_norm=bar_markers[idx].yNorm,
                            y_end_norm=bar_markers[idx + 1].yNorm,
                        ),
                    )
                )
                idx += 2
            if idx < len(bar_markers):
                ops.append(
                    (
                        "range-open",
                        SliceSpec(
                            mode="y_range",
                            y_start_norm=bar_markers[idx].yNorm,
                            y_end_norm=1.0,
                        ),
                    )
                )

    return ops
