from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Literal

import cv2
import numpy as np
from pydantic import BaseModel, Field

from models import OcrBackendKind
from sticky_detector import encode_jpeg_bytes

logger = logging.getLogger(__name__)

_LETTER_HYPHEN_END_RE = re.compile(r"([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])[-‐‑\u00ad]\s*$")
_LOWER_START_RE = re.compile(r"^\s*([a-záéíóúüñ])")
_SENTENCE_END_RE = re.compile(r"[.!?»”:;]\s*$")

_STANDALONE_PAGE_NUM_RE = re.compile(
    r"^\s*(?:p[áa]g(?:ina)?\.?\s*)?[-–—·•|\[\(]?\s*(\d{1,4})\s*[-–—·•|\]\)]?\s*$",
    re.IGNORECASE,
)
_HEADER_LEADING_NUM_RE = re.compile(r"^\s*(\d{1,4})\s{2,}\S+.*$")
_HEADER_TRAILING_NUM_RE = re.compile(r"^.*\S+\s{2,}(\d{1,4})\s*$")

_TOC_HEADING_RE = re.compile(
    r"^\s*(?:[íi]ndice(?:\s+general|\s+de\s+contenidos)?|contenido|contenidos|sumario|table\s+of\s+contents|contents)\s*$",
    re.IGNORECASE,
)
_TOC_ENTRY_RE = re.compile(
    r"^\s*(.+?)\s*(?:[\.·…_/\-]{2,}\s*|\s{2,}|\s+)(\d{1,4})\s*$"
)
_CHAPTER_PREFIX_RE = re.compile(
    r"^\s*(?:cap[íi]tulo|cap\.|chapter|parte|part|libro|secci[óo]n|pr[óo]logo|prefacio|introducci[óo]n|ep[íi]logo|meditaci[óo]n)\b",
    re.IGNORECASE,
)
_CHAPTER_BARE_PREFIX_RE = re.compile(
    r"^\s*(?:cap[íi]tulo|cap\.|chapter|parte|part|libro|secci[óo]n|meditaci[óo]n)\s*(?:[IVXLCDM]{1,7}|\d{1,3})\s*[:.\-–—]?\s*$",
    re.IGNORECASE,
)
_NUMBERED_HEADING_RE = re.compile(
    r"^\s*(?:[IVXLCDM]{1,6}|\d{1,2})\s*[\.:\-–—]\s+[A-ZÁÉÍÓÚÜÑ«\"¡¿].{1,75}$"
)


@dataclass(slots=True)
class SliceSpec:
    mode: Literal["paragraph_at_y", "y_range"]
    y_norm: float = 0.0
    y_start_norm: float = 0.0
    y_end_norm: float = 1.0


@dataclass(slots=True)
class PageAnalysis:
    page_number: int | None = None
    is_toc: bool = False
    toc_entries: dict[int, str] = field(default_factory=dict)
    chapter_title: str | None = None
    extracted_slices: list[str] = field(default_factory=list)
    backend_used: Literal["gemini", "rapidocr"] = "rapidocr"


@dataclass(slots=True)
class _OcrBox:
    x1: float
    y1: float
    x2: float
    y2: float
    text: str
    score: float

    @property
    def yc(self) -> float:
        return 0.5 * (self.y1 + self.y2)

    @property
    def h(self) -> float:
        return max(1.0, self.y2 - self.y1)

    @property
    def w(self) -> float:
        return max(1.0, self.x2 - self.x1)


@dataclass(slots=True)
class _TextLine:
    x1: float
    y1: float
    x2: float
    y2: float
    text: str
    boxes: list[_OcrBox]

    @property
    def yc(self) -> float:
        return 0.5 * (self.y1 + self.y2)

    @property
    def h(self) -> float:
        return max(1.0, self.y2 - self.y1)

    @property
    def w(self) -> float:
        return max(1.0, self.x2 - self.x1)


@dataclass(slots=True)
class _Paragraph:
    lines: list[_TextLine]
    y1: float
    y2: float
    text: str


class _GeminiTocItem(BaseModel):
    title: str
    page: int


class _GeminiExtractionSchema(BaseModel):
    pageNumber: int | None = None
    isToc: bool = False
    tocEntries: list[_GeminiTocItem] = Field(default_factory=list)
    chapterTitle: str | None = None
    extractedSlices: list[str] = Field(default_factory=list)


def get_ocr_backend_name() -> OcrBackendKind:
    configured = os.getenv("OCR_BACKEND", "hybrid").strip().lower()
    has_gemini_key = bool(os.getenv("GEMINI_API_KEY", "").strip())
    if configured == "rapidocr" or not has_gemini_key:
        return "rapidocr"
    if configured == "gemini":
        return "gemini"
    return "hybrid"


def dehyphenate_join(first: str, second: str) -> str:
    """Join two consecutive lines or page chunks, repairing hyphenated line-break words."""
    a = first.rstrip()
    b = second.lstrip()
    if not a:
        return b
    if not b:
        return a
    if _LETTER_HYPHEN_END_RE.search(a) and _LOWER_START_RE.match(b):
        a_stem = re.sub(r"[-‐‑\u00ad]\s*$", "", a)
        return re.sub(r"[ \t]{2,}", " ", f"{a_stem}{b}")
    return re.sub(r"[ \t]{2,}", " ", f"{a} {b}")


def join_lines_into_paragraph(lines: list[str]) -> str:
    result = ""
    for line in lines:
        cleaned = line.strip()
        if not cleaned:
            continue
        result = dehyphenate_join(result, cleaned) if result else cleaned
    return result.strip()


def merge_range_chunks(chunks: list[str]) -> str:
    """Merge multi-page range segments, de-hyphenating cross-page word splits cleanly."""
    non_empty = [c.strip() for c in chunks if c and c.strip()]
    if not non_empty:
        return ""
    merged = non_empty[0]
    for nxt in non_empty[1:]:
        if _LETTER_HYPHEN_END_RE.search(merged) and _LOWER_START_RE.match(nxt):
            merged = dehyphenate_join(merged, nxt)
        elif _SENTENCE_END_RE.search(merged) and not _LOWER_START_RE.match(nxt):
            merged = f"{merged}\n\n{nxt}"
        else:
            merged = dehyphenate_join(merged, nxt)
    return merged.strip()


def looks_like_structural_page_fast(page_bgr: np.ndarray) -> bool:
    """Stage 1 (< 5ms OpenCV) structural check for unmarked pages.

    Returns True only if the page exhibits Table-of-Contents or Chapter-Opener
    typography (deep top sink, prominent display heading, short title + gap, or
    aligned right-hand page numbers). Plain full-body prose pages return False
    immediately so Stage 2 OCR is skipped completely.
    """
    gray = cv2.cvtColor(page_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    if h < 60 or w < 60:
        return False

    if h > 660:
        scale = 660.0 / float(h)
        gray = cv2.resize(
            gray,
            (max(40, int(w * scale)), 660),
            interpolation=cv2.INTER_AREA,
        )
        h, w = gray.shape[:2]

    bg_luma = float(np.percentile(gray, 82))
    ink = ((gray < (bg_luma - 32)).astype(np.uint8)) * 255

    # Mask out outer borders, running header (< 9%), and footer page number (> 87%).
    y_top_cut = int(0.09 * h)
    y_bot_cut = int(0.87 * h)
    x_pad = int(0.06 * w)
    body = ink[y_top_cut:y_bot_cut, x_pad : w - x_pad]
    bh, bw = body.shape[:2]
    if bh < 30 or bw < 30:
        return False

    line_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (max(16, int(0.065 * bw)), 2)
    )
    dilated = cv2.dilate(body, line_kernel, iterations=1)
    cnts, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    lines: list[tuple[int, int, int, int]] = []
    min_w = max(12, int(0.07 * bw))
    for c in cnts:
        lx, ly, lw, lh = cv2.boundingRect(c)
        if lw >= min_w and 4 <= lh <= int(0.18 * bh):
            lines.append((lx, ly + y_top_cut, lw, lh))

    if not lines:
        return False

    lines.sort(key=lambda r: r[1])
    num_lines = len(lines)

    # Sparse text pages (1..8 lines) may be Part/Chapter dividers or short TOCs.
    if num_lines <= 8:
        return True

    first_y = lines[0][1]
    # Deep top sink (>= 19.5% from top of page) is a classic chapter-start layout.
    if first_y >= int(0.195 * h):
        return True

    heights = np.array([r[3] for r in lines], dtype=np.float32)
    widths = np.array([r[2] for r in lines], dtype=np.float32)
    med_h = float(np.median(heights))
    col_w = float(np.percentile(widths, 90))

    # Tall display heading in the upper 42% of the page.
    for _, ly, _, lh in lines[:4]:
        if ly <= int(0.42 * h) and lh >= max(med_h * 1.30, med_h + 4.0):
            return True

    # Short/centered title line(s) in top 32% followed by a larger vertical gap than body prose.
    gaps = [
        max(0, lines[i + 1][1] - (lines[i][1] + lines[i][3]))
        for i in range(len(lines) - 1)
    ]
    med_gap = float(np.median(gaps)) if gaps else med_h * 0.5
    for idx in range(min(2, len(lines) - 2)):
        _, ly, lw, lh = lines[idx]
        gap_after = gaps[idx]
        if (
            ly <= int(0.32 * h)
            and lw <= 0.72 * col_w
            and gap_after >= max(med_gap * 1.75, med_h * 0.95)
        ):
            return True

    # TOC check: look for >= 4 lines that split into a left title and a narrow right number cluster.
    word_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (max(6, int(0.02 * bw)), 2)
    )
    word_dilated = cv2.dilate(body, word_kernel, iterations=1)
    toc_like_rows = 0
    right_edges: list[int] = []
    for _, ly, lw, lh in lines:
        ry0 = max(0, ly - y_top_cut)
        ry1 = min(bh, ry0 + lh)
        row_slice = word_dilated[ry0:ry1, :]
        w_cnts, _ = cv2.findContours(
            row_slice, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        spans = sorted(
            (cv2.boundingRect(wc) for wc in w_cnts if cv2.boundingRect(wc)[2] >= 5),
            key=lambda s: s[0],
        )
        if len(spans) >= 2:
            last_x, _, last_w, _ = spans[-1]
            prev_x, _, prev_w, _ = spans[-2]
            horiz_gap = last_x - (prev_x + prev_w)
            if last_w <= 0.14 * bw and horiz_gap >= 0.04 * bw:
                toc_like_rows += 1
                right_edges.append(last_x + last_w)

    if toc_like_rows >= 4 and right_edges:
        if float(np.std(right_edges)) <= 0.06 * bw:
            return True

    return False


class HybridOcrEngine:
    """2-stage Hybrid OCR Engine: Gemini 2.5 Flash primary + RapidOCR local fallback."""

    def __init__(self) -> None:
        self._rapid_ocr = None
        self._gemini_client = None
        self._gemini_client_key: str | None = None

    def _get_rapid_ocr(self):
        if self._rapid_ocr is None:
            from rapidocr_onnxruntime import RapidOCR

            self._rapid_ocr = RapidOCR(
                det_limit_side_len=1600,
                det_unclip_ratio=2.3,
                det_box_thresh=0.4,
            )
        return self._rapid_ocr

    def _get_gemini_client(self, api_key: str):
        if self._gemini_client is None or self._gemini_client_key != api_key:
            from google import genai

            self._gemini_client = genai.Client(api_key=api_key)
            self._gemini_client_key = api_key
        return self._gemini_client

    def analyze_page(
        self,
        page_bgr: np.ndarray,
        slice_specs: list[SliceSpec] | None = None,
    ) -> PageAnalysis:
        specs = slice_specs or []
        backend = get_ocr_backend_name()
        api_key = os.getenv("GEMINI_API_KEY", "").strip()

        if backend in {"gemini", "hybrid"} and api_key:
            try:
                return self._analyze_with_gemini(page_bgr, specs, api_key)
            except Exception as exc:
                logger.warning(
                    "Gemini OCR failed (%s); falling back automatically to RapidOCR.",
                    exc,
                )

        return self._analyze_with_rapidocr(page_bgr, specs)

    def _analyze_with_gemini(
        self,
        page_bgr: np.ndarray,
        specs: list[SliceSpec],
        api_key: str,
    ) -> PageAnalysis:
        from google.genai import types

        jpeg_bytes = encode_jpeg_bytes(page_bgr, quality=88)
        model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"

        slice_instructions: list[str] = []
        for idx, spec in enumerate(specs):
            if spec.mode == "paragraph_at_y":
                slice_instructions.append(
                    f"Slice {idx}: SINGLE PARAGRAPH aligned with normalized vertical position "
                    f"yNorm={spec.y_norm:.3f} (0.0=top edge, 1.0=bottom edge). Return ONLY that single "
                    f"complete paragraph, excluding headers/footers/page numbers, de-hyphenating line breaks."
                )
            else:
                slice_instructions.append(
                    f"Slice {idx}: RANGE of body text from yStartNorm={spec.y_start_norm:.3f} "
                    f"down to yEndNorm={spec.y_end_norm:.3f}. Exclude running headers, chapter titles, "
                    f"and page numbers; de-hyphenate words split across lines."
                )

        slices_prompt = (
            "\n".join(slice_instructions)
            if slice_instructions
            else "No text slices requested (return empty list for extractedSlices)."
        )

        prompt = (
            "Analyze this single book page image.\n"
            "1. Extract the printed `pageNumber` (integer) if visible in header or footer, else null.\n"
            "2. Determine if this page is a Table of Contents (`isToc`: boolean). If true, extract "
            "`tocEntries` with chapter `title` and starting `page` integer.\n"
            "3. Determine if a new chapter starts on this page (`chapterTitle`: string or null).\n"
            "4. Extract `extractedSlices` in exact order matching the requested slices below "
            "(preserve original language and accents accurately):\n"
            f"{slices_prompt}"
        )

        client = self._get_gemini_client(api_key)
        response = client.models.generate_content(
            model=model_name,
            contents=[
                types.Part.from_bytes(data=jpeg_bytes, mime_type="image/jpeg"),
                prompt,
            ],
            config=types.GenerateContentConfig(
                temperature=0.0,
                response_mime_type="application/json",
                response_schema=_GeminiExtractionSchema,
            ),
        )

        raw_text = response.text or "{}"
        parsed = _GeminiExtractionSchema.model_validate(json.loads(raw_text))
        toc_map = {
            item.page: item.title.strip()
            for item in parsed.tocEntries
            if item.title.strip() and item.page >= 0
        }
        cleaned_slices = [s.strip() for s in parsed.extractedSlices]
        # Pad or trim to match requested specs length.
        if len(cleaned_slices) < len(specs):
            cleaned_slices.extend([""] * (len(specs) - len(cleaned_slices)))
        elif len(cleaned_slices) > len(specs):
            cleaned_slices = cleaned_slices[: len(specs)]

        return PageAnalysis(
            page_number=parsed.pageNumber,
            is_toc=parsed.isToc,
            toc_entries=toc_map,
            chapter_title=parsed.chapterTitle.strip() if parsed.chapterTitle else None,
            extracted_slices=cleaned_slices,
            backend_used="gemini",
        )

    def _analyze_with_rapidocr(
        self,
        page_bgr: np.ndarray,
        specs: list[SliceSpec],
    ) -> PageAnalysis:
        h, w = page_bgr.shape[:2]
        ocr = self._get_rapid_ocr()
        raw_result, _ = ocr(page_bgr)

        if not raw_result:
            return PageAnalysis(
                extracted_slices=["" for _ in specs],
                backend_used="rapidocr",
            )

        boxes: list[_OcrBox] = []
        for item in raw_result:
            quad, text, score = item[0], str(item[1]).strip(), float(item[2])
            if not text or score < 0.30:
                continue
            xs = [float(p[0]) for p in quad]
            ys = [float(p[1]) for p in quad]
            boxes.append(
                _OcrBox(
                    x1=min(xs),
                    y1=min(ys),
                    x2=max(xs),
                    y2=max(ys),
                    text=text,
                    score=score,
                )
            )

        if not boxes:
            return PageAnalysis(
                extracted_slices=["" for _ in specs],
                backend_used="rapidocr",
            )

        lines = _group_boxes_into_lines(boxes)
        page_number, body_lines = _strip_headers_and_extract_page_number(lines, h, w)

        is_toc, toc_entries = _detect_toc(body_lines, h)
        if is_toc:
            return PageAnalysis(
                page_number=page_number,
                is_toc=True,
                toc_entries=toc_entries,
                chapter_title=None,
                extracted_slices=["" for _ in specs],
                backend_used="rapidocr",
            )

        chapter_title, prose_lines = _extract_chapter_heading(body_lines, h)
        paragraphs = _group_lines_into_paragraphs(prose_lines, w)

        extracted: list[str] = []
        for spec in specs:
            if spec.mode == "paragraph_at_y":
                extracted.append(_slice_paragraph_at_y(paragraphs, spec.y_norm * h))
            else:
                extracted.append(
                    _slice_y_range(
                        paragraphs,
                        y_start=spec.y_start_norm * h,
                        y_end=spec.y_end_norm * h,
                    )
                )

        return PageAnalysis(
            page_number=page_number,
            is_toc=False,
            toc_entries={},
            chapter_title=chapter_title,
            extracted_slices=extracted,
            backend_used="rapidocr",
        )


def _group_boxes_into_lines(boxes: list[_OcrBox]) -> list[_TextLine]:
    sorted_boxes = sorted(boxes, key=lambda b: (b.yc, b.x1))
    clusters: list[list[_OcrBox]] = []

    for box in sorted_boxes:
        placed = False
        for cluster in clusters:
            ref_yc = sum(b.yc for b in cluster) / len(cluster)
            ref_h = max(b.h for b in cluster)
            if abs(box.yc - ref_yc) <= 0.55 * max(ref_h, box.h):
                cluster.append(box)
                placed = True
                break
        if not placed:
            clusters.append([box])

    text_lines: list[_TextLine] = []
    for cluster in clusters:
        cluster.sort(key=lambda b: b.x1)
        parts: list[str] = [cluster[0].text]
        for prev, curr in zip(cluster, cluster[1:]):
            gap = curr.x1 - prev.x2
            avg_char_w = max(4.0, prev.w / max(1, len(prev.text)))
            sep = "   " if gap > 2.4 * avg_char_w else " "
            parts.append(sep + curr.text)
        joined = "".join(parts).strip()
        text_lines.append(
            _TextLine(
                x1=min(b.x1 for b in cluster),
                y1=min(b.y1 for b in cluster),
                x2=max(b.x2 for b in cluster),
                y2=max(b.y2 for b in cluster),
                text=joined,
                boxes=cluster,
            )
        )

    text_lines.sort(key=lambda ln: ln.yc)
    return text_lines


def _parse_margin_page_number(line: _TextLine, page_w: float) -> int | None:
    txt = line.text.strip()
    m_num = _STANDALONE_PAGE_NUM_RE.match(txt)
    if m_num:
        val = int(m_num.group(1))
        if 1 <= val <= 5000:
            return val

    # Check multi-box running header where leftmost or rightmost box is a page number.
    if len(line.boxes) >= 2:
        first_b, last_b = line.boxes[0], line.boxes[-1]
        m_last = _STANDALONE_PAGE_NUM_RE.match(last_b.text)
        if m_last and last_b.x1 >= 0.65 * page_w:
            val = int(m_last.group(1))
            if 1 <= val <= 5000:
                return val
        m_first = _STANDALONE_PAGE_NUM_RE.match(first_b.text)
        if m_first and first_b.x2 <= 0.35 * page_w:
            val = int(m_first.group(1))
            if 1 <= val <= 5000:
                return val

    for rx in (_HEADER_TRAILING_NUM_RE, _HEADER_LEADING_NUM_RE):
        m = rx.match(txt)
        if m:
            val = int(m.group(1))
            if 1 <= val <= 5000:
                return val

    return None


def _strip_headers_and_extract_page_number(
    lines: list[_TextLine],
    page_h: int,
    page_w: int,
) -> tuple[int | None, list[_TextLine]]:
    if not lines:
        return None, []

    page_number: int | None = None
    drop_indices: set[int] = set()
    med_h = float(np.median([ln.h for ln in lines]))

    # Check bottom-most line(s) for printed footer page number.
    last_idx = len(lines) - 1
    last_ln = lines[last_idx]
    if last_ln.yc >= 0.84 * page_h:
        parsed = _parse_margin_page_number(last_ln, page_w)
        if parsed is not None:
            page_number = parsed
            drop_indices.add(last_idx)

    # Check top-most line for running header / top page number.
    first_ln = lines[0]
    if 0 not in drop_indices and first_ln.yc <= 0.125 * page_h:
        parsed_top = _parse_margin_page_number(first_ln, page_w)
        if parsed_top is not None:
            if page_number is None:
                page_number = parsed_top
            drop_indices.add(0)
        elif (
            len(lines) >= 3
            and first_ln.yc <= 0.095 * page_h
            and first_ln.h <= 1.05 * med_h
            and not _CHAPTER_PREFIX_RE.match(first_ln.text)
            and not _TOC_HEADING_RE.match(first_ln.text)
            and (lines[1].y1 - first_ln.y2) >= 1.5 * med_h
            and len(first_ln.text) <= 55
        ):
            # Short small running header (book/author title) at very top margin.
            drop_indices.add(0)

    kept = [ln for idx, ln in enumerate(lines) if idx not in drop_indices]
    return page_number, kept


def _clean_toc_title(raw_title: str) -> str:
    cleaned = re.sub(r"[\.·…_/\-\s]+$", "", raw_title).strip()
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned


def _detect_toc(
    lines: list[_TextLine],
    page_h: int,
) -> tuple[bool, dict[int, str]]:
    if not lines:
        return False, {}

    has_toc_heading = any(
        ln.yc <= 0.35 * page_h and bool(_TOC_HEADING_RE.match(ln.text.strip()))
        for ln in lines[:3]
    )

    entries: list[tuple[int, str]] = []
    for ln in lines:
        txt = ln.text.strip()
        if _TOC_HEADING_RE.match(txt):
            continue

        # Multi-box TOC row: title on left, page number box on right.
        if len(ln.boxes) >= 2:
            last_box = ln.boxes[-1]
            m_right = re.match(r"^\s*(\d{1,4})\s*$", last_box.text)
            if m_right:
                pnum = int(m_right.group(1))
                left_text = _clean_toc_title(
                    " ".join(b.text for b in ln.boxes[:-1])
                )
                if len(re.findall(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]", left_text)) >= 3:
                    entries.append((pnum, left_text))
                    continue

        m = _TOC_ENTRY_RE.match(txt)
        if m:
            title = _clean_toc_title(m.group(1))
            pnum = int(m.group(2))
            if (
                1 <= pnum <= 5000
                and len(re.findall(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]", title)) >= 3
            ):
                entries.append((pnum, title))

    if has_toc_heading and len(entries) >= 1:
        return True, {p: t for p, t in entries}

    if len(entries) >= 3:
        pages_seq = [p for p, _ in entries]
        non_decreasing = sum(
            1 for a, b in zip(pages_seq, pages_seq[1:]) if b >= a
        )
        if non_decreasing >= len(pages_seq) - 2:
            return True, {p: t for p, t in entries}

    return False, {}


def _extract_chapter_heading(
    lines: list[_TextLine],
    page_h: int,
) -> tuple[str | None, list[_TextLine]]:
    if not lines:
        return None, []

    first = lines[0]
    if first.yc > 0.52 * page_h:
        return None, lines

    med_h = float(np.median([ln.h for ln in lines]))
    first_txt = first.text.strip()

    # Case 1: Explicit chapter/part/section prefix on line 0.
    if _CHAPTER_PREFIX_RE.match(first_txt):
        if _CHAPTER_BARE_PREFIX_RE.match(first_txt) and len(lines) >= 2:
            second = lines[1]
            second_txt = second.text.strip()
            gap_12 = (
                lines[2].y1 - second.y2 if len(lines) >= 3 else float(page_h)
            )
            if (
                second.yc <= 0.55 * page_h
                and len(second_txt) <= 75
                and gap_12 >= med_h * 0.9
            ):
                prefix = first_txt.rstrip(":.-–— ")
                return f"{prefix}: {second_txt}", lines[2:]
        return first_txt, lines[1:]

    # Case 2: Numbered / Roman numeral heading at top followed by larger vertical gap.
    if _NUMBERED_HEADING_RE.match(first_txt) and len(first_txt) <= 75:
        if len(lines) == 1 or (lines[1].y1 - first.y2) >= med_h * 0.85:
            return first_txt, lines[1:]

    # Case 3: Typographic heading (taller display font OR deep top sink + short standalone title).
    if len(lines) == 1 and len(first_txt) <= 80 and not first_txt.endswith("."):
        return first_txt, []

    if len(lines) >= 2:
        body_med_h = float(np.median([ln.h for ln in lines[1:]]))
        gap_01 = lines[1].y1 - first.y2
        body_gaps = [
            max(0.0, lines[i + 1].y1 - lines[i].y2)
            for i in range(1, len(lines) - 1)
        ]
        med_body_gap = float(np.median(body_gaps)) if body_gaps else body_med_h * 0.45

        is_taller = first.h >= max(body_med_h * 1.28, body_med_h + 4.0)
        is_sunk_short_title = (
            first.y1 >= 0.20 * page_h
            and len(first_txt) <= 65
            and not first_txt.endswith((",", ";", "-"))
        )
        has_heading_gap = gap_01 >= max(med_body_gap * 1.75, body_med_h * 0.90)

        if (is_taller or is_sunk_short_title) and has_heading_gap and len(first_txt) <= 85:
            return first_txt, lines[1:]

    return None, lines


def _group_lines_into_paragraphs(
    lines: list[_TextLine],
    page_w: int,
) -> list[_Paragraph]:
    if not lines:
        return []

    if len(lines) == 1:
        ln = lines[0]
        return [
            _Paragraph(
                lines=[ln],
                y1=ln.y1,
                y2=ln.y2,
                text=join_lines_into_paragraph([ln.text]),
            )
        ]

    med_h = float(np.median([ln.h for ln in lines]))
    left_margin = float(np.percentile([ln.x1 for ln in lines], 15))
    right_margin = float(np.percentile([ln.x2 for ln in lines], 85))

    raw_gaps = [max(0.0, lines[i + 1].y1 - lines[i].y2) for i in range(len(lines) - 1)]
    tight_gaps = [g for g in raw_gaps if g < 1.05 * med_h]
    intra_gap = (
        float(np.percentile(tight_gaps, 45)) if tight_gaps else 0.45 * med_h
    )
    gap_split_thresh = min(
        1.10 * med_h,
        max(intra_gap * 1.55, intra_gap + 0.26 * med_h, 0.55 * med_h),
    )

    groups: list[list[_TextLine]] = [[lines[0]]]
    for prev, curr in zip(lines, lines[1:]):
        gap = max(0.0, curr.y1 - prev.y2)
        is_gap_break = gap >= gap_split_thresh
        is_indented_new_para = (
            (curr.x1 - left_margin) >= 1.35 * med_h
            and gap >= intra_gap * 0.75
        )
        is_prev_short_tail = (
            (right_margin - prev.x2) >= 2.6 * med_h
            and (right_margin - left_margin) >= 6.0 * med_h
            and gap >= max(intra_gap * 1.22, intra_gap + 0.14 * med_h)
        )

        if is_gap_break or is_indented_new_para or is_prev_short_tail:
            groups.append([curr])
        else:
            groups[-1].append(curr)

    paragraphs: list[_Paragraph] = []
    for grp in groups:
        txt = join_lines_into_paragraph([ln.text for ln in grp])
        if txt:
            paragraphs.append(
                _Paragraph(
                    lines=grp,
                    y1=grp[0].y1,
                    y2=grp[-1].y2,
                    text=txt,
                )
            )
    return paragraphs


def _slice_paragraph_at_y(paragraphs: list[_Paragraph], y_px: float) -> str:
    if not paragraphs:
        return ""

    def _dist(p: _Paragraph) -> tuple[float, float]:
        if p.y1 <= y_px <= p.y2:
            return (0.0, abs(y_px - 0.5 * (p.y1 + p.y2)))
        if y_px < p.y1:
            # Slight preference when marker sits as an overline right above line 1.
            return ((p.y1 - y_px) * 0.92, p.y1 - y_px)
        return (y_px - p.y2, y_px - p.y2)

    best = min(paragraphs, key=_dist)
    return best.text


def _slice_y_range(
    paragraphs: list[_Paragraph],
    y_start: float,
    y_end: float,
) -> str:
    if not paragraphs:
        return ""
    if y_end < y_start:
        y_start, y_end = y_end, y_start

    para_chunks: list[str] = []
    for para in paragraphs:
        chosen_lines = [
            ln.text
            for ln in para.lines
            if (y_start - 0.68 * ln.h) <= ln.yc <= (y_end + 0.68 * ln.h)
        ]
        if chosen_lines:
            joined = join_lines_into_paragraph(chosen_lines)
            if joined:
                para_chunks.append(joined)

    if para_chunks:
        return "\n\n".join(para_chunks)

    # Fallback if two bars bracketed tightly inside/around a single paragraph.
    mid_y = 0.5 * (y_start + y_end)
    return _slice_paragraph_at_y(paragraphs, mid_y)
