from __future__ import annotations

import math
import os
from dataclasses import dataclass

import cv2
import numpy as np

from models import DetectedMarker, PageSide, SpreadMode


DEFAULT_BLUR_THRESHOLD = 28.0
DEFAULT_DHASH_THRESHOLD = 4


@dataclass(slots=True)
class FrameSignature:
    dhash: int
    sticky_Grid: tuple[int, ...]


@dataclass(slots=True)
class _StripCandidate:
    cx: float
    cy: float
    length: float
    thickness: float
    angle_deg: float
    p1: tuple[float, float]
    p2: tuple[float, float]
    bbox: tuple[int, int, int, int]


def decode_frame_bytes(raw_bytes: bytes) -> np.ndarray:
    """Decode JPEG/PNG/WebP bytes directly in RAM without touching disk."""
    if not raw_bytes:
        raise ValueError("Empty image payload.")
    buf = np.frombuffer(raw_bytes, dtype=np.uint8)
    if buf.size == 0:
        raise ValueError("Empty image buffer.")
    bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if bgr is None or bgr.size == 0:
        raise ValueError("Unable to decode image bytes.")
    return bgr


def encode_jpeg_bytes(bgr: np.ndarray, quality: int = 88) -> bytes:
    """Encode a BGR array to JPEG bytes in RAM (used only for Gemini API calls)."""
    ok, encoded = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise ValueError("Failed to encode image to JPEG in memory.")
    return encoded.tobytes()


def compute_blur_score(bgr: np.ndarray) -> float:
    """Compute scale-normalized Laplacian variance for sharpness gating."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    max_dim = max(h, w)
    if max_dim > 900:
        scale = 900.0 / max_dim
        gray = cv2.resize(
            gray,
            (max(1, int(w * scale)), max(1, int(h * scale))),
            interpolation=cv2.INTER_AREA,
        )
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    return float(lap.var())


def is_frame_blurry(bgr: np.ndarray, threshold: float | None = None) -> tuple[bool, float]:
    limit = (
        threshold
        if threshold is not None
        else float(os.getenv("BLUR_LAPLACIAN_THRESHOLD", str(DEFAULT_BLUR_THRESHOLD)))
    )
    score = compute_blur_score(bgr)
    return score < limit, score


def compute_dhash(bgr: np.ndarray) -> int:
    """Compute 64-bit horizontal difference hash (dHash) cropped to active page content."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    y0, y1 = int(0.04 * h), max(int(0.04 * h) + 1, int(0.96 * h))
    x0, x1 = int(0.04 * w), max(int(0.04 * w) + 1, int(0.96 * w))
    interior = gray[y0:y1, x0:x1]

    # Tightly crop to non-paper foreground (ink + stickies) so sparse 1-line pages
    # don't produce 7 identical all-white rows in the 9x8 dHash grid.
    bg_val = float(np.percentile(interior, 85))
    fg_ys, fg_xs = np.nonzero(interior < (bg_val - 24.0))
    if fg_xs.size >= 25:
        cy0 = max(0, int(fg_ys.min()) - 8)
        cy1 = min(interior.shape[0], int(fg_ys.max()) + 9)
        cx0 = max(0, int(fg_xs.min()) - 8)
        cx1 = min(interior.shape[1], int(fg_xs.max()) + 9)
        crop = interior[cy0:cy1, cx0:cx1]
    else:
        crop = interior

    k_h = max(2, crop.shape[0] // 70)
    k_w = max(2, crop.shape[1] // 35)
    emphasized = cv2.erode(crop, np.ones((k_h, k_w), dtype=np.uint8))
    small = cv2.resize(emphasized, (9, 8), interpolation=cv2.INTER_AREA)
    diff = small[:, 1:] > small[:, :-1]
    value = 0
    for bit in diff.flatten():
        value = (value << 1) | int(bool(bit))
    return value


def hamming_distance_64(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def compute_frame_signature(bgr: np.ndarray) -> FrameSignature:
    """Combine 64-bit content dHash with an 8x8 peak-chroma grid so sticky changes register."""
    dhash = compute_dhash(bgr)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    a_ch = lab[:, :, 1].astype(np.float32)
    b_ch = lab[:, :, 2].astype(np.float32)
    a_med = float(np.median(a_ch))
    b_med = float(np.median(b_ch))
    chroma = np.hypot(a_ch - a_med, b_ch - b_med)
    # Resize to 64x64 then take 8x8 block MAX so even a thin sticky strip stands out clearly.
    grid64 = cv2.resize(chroma, (64, 64), interpolation=cv2.INTER_LINEAR)
    peak8 = grid64.reshape(8, 8, 8, 8).max(axis=(1, 3))
    quantized = tuple(int(v // 10.0) for v in peak8.flatten())
    return FrameSignature(dhash=dhash, sticky_Grid=quantized)


def is_duplicate_frame(
    sig: FrameSignature,
    prev_sig: FrameSignature | None,
    max_hamming: int | None = None,
) -> bool:
    if prev_sig is None:
        return False
    limit = (
        max_hamming
        if max_hamming is not None
        else int(os.getenv("DHASH_DUPLICATE_THRESHOLD", str(DEFAULT_DHASH_THRESHOLD)))
    )
    if hamming_distance_64(sig.dhash, prev_sig.dhash) > limit:
        return False
    chroma_shift = max(
        abs(x - y) for x, y in zip(sig.sticky_Grid, prev_sig.sticky_Grid)
    )
    return chroma_shift <= 1


def split_spread(
    bgr: np.ndarray,
    spread_mode: SpreadMode = "auto",
) -> list[tuple[PageSide, np.ndarray]]:
    """Split a two-page spread into [('left', img), ('right', img)] or [('single', img)]."""
    if spread_mode == "single":
        return [("single", bgr)]

    h, w = bgr.shape[:2]
    if w < 80 or h < 80:
        return [("single", bgr)]

    aspect = w / float(h)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    x_lo = int(0.42 * w)
    x_hi = int(0.58 * w)
    if x_hi <= x_lo + 4:
        return [("single", bgr)]

    # Inspect vertical spine shadow (column mean luma dip) and vertical ink gap near center.
    y_band = gray[int(0.08 * h) : int(0.92 * h), :]
    col_luma = y_band.mean(axis=0)
    smooth_w = max(5, (w // 120) | 1)
    col_luma_smooth = cv2.GaussianBlur(
        col_luma.reshape(1, -1).astype(np.float32), (smooth_w, 1), 0
    ).ravel()

    left_ref = float(np.median(col_luma_smooth[int(0.20 * w) : int(0.38 * w)]))
    right_ref = float(np.median(col_luma_smooth[int(0.62 * w) : int(0.80 * w)]))
    page_ref = min(left_ref, right_ref)

    center_slice = col_luma_smooth[x_lo:x_hi]
    min_idx = int(np.argmin(center_slice))
    spine_x = x_lo + min_idx
    spine_luma = float(center_slice[min_idx])
    has_spine_shadow = (page_ref - spine_luma) >= 4.5

    # Also check for a clean vertical ink-free gutter separating two text columns.
    bg_luma = float(np.percentile(y_band, 85))
    ink = (y_band < (bg_luma - 32)).astype(np.float32)
    col_ink = cv2.GaussianBlur(
        ink.mean(axis=0).reshape(1, -1), (max(7, (w // 80) | 1), 1), 0
    ).ravel()
    left_ink = float(col_ink[int(0.15 * w) : int(0.40 * w)].max(initial=0.0))
    right_ink = float(col_ink[int(0.60 * w) : int(0.85 * w)].max(initial=0.0))
    gutter_min_idx = int(np.argmin(col_ink[x_lo:x_hi]))
    gutter_min_ink = float(col_ink[x_lo + gutter_min_idx])
    has_text_gutter = (
        left_ink >= 0.04 and right_ink >= 0.04 and gutter_min_ink <= 0.012
    )

    if spread_mode == "auto":
        if aspect <= 1.18 or not (has_spine_shadow or has_text_gutter):
            return [("single", bgr)]

    split_x = spine_x if has_spine_shadow else (x_lo + gutter_min_idx if has_text_gutter else w // 2)
    split_x = max(int(0.35 * w), min(int(0.65 * w), split_x))
    return [
        ("left", bgr[:, :split_x]),
        ("right", bgr[:, split_x:]),
    ]


def _build_sticky_mask(page_bgr: np.ndarray) -> np.ndarray:
    """Segment translucent neon and pastel sticky strips against white/cream paper."""
    hsv = cv2.cvtColor(page_bgr, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(page_bgr, cv2.COLOR_BGR2LAB)

    s_ch = hsv[:, :, 1].astype(np.float32)
    v_ch = hsv[:, :, 2].astype(np.float32)
    l_ch = lab[:, :, 0].astype(np.float32)
    a_ch = lab[:, :, 1].astype(np.float32)
    b_ch = lab[:, :, 2].astype(np.float32)

    # Estimate paper background chromaticity from bright pixels (excluding dark ink).
    bright = l_ch >= np.percentile(l_ch, 40)
    a_bg = float(np.median(a_ch[bright])) if np.any(bright) else 128.0
    b_bg = float(np.median(b_ch[bright])) if np.any(bright) else 128.0
    s_bg = float(np.median(s_ch[bright])) if np.any(bright) else 10.0

    chroma_dist = np.hypot(a_ch - a_bg, b_ch - b_bg)

    # Pastel & neon stickies stand out strongly in LAB chroma shift relative to paper
    # AND/OR HSV saturation delta, while staying reasonably bright (not dark ink/shadow).
    mask_bool = (v_ch >= 85.0) & (l_ch >= 75.0) & (
        (chroma_dist >= 13.5) | ((s_ch - s_bg) >= 36.0) & (chroma_dist >= 9.5)
    )
    mask = (mask_bool.astype(np.uint8)) * 255

    # Close small dark-letter holes inside translucent sticky strips sitting over text,
    # then open tiny 2px dust specks.
    h, w = mask.shape[:2]
    close_sz = max(5, min(11, int(round(min(h, w) * 0.009)) | 1))
    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (close_sz, close_sz)),
    )
    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)),
    )
    return mask


def _extract_strip_geometry(
    cnt: np.ndarray,
    bbox: tuple[int, int, int, int],
    area: float,
    min_len: float,
    max_thick: float,
) -> _StripCandidate | None:
    rect = cv2.minAreaRect(cnt)
    (rcx, rcy), (rw, rh), _ = rect
    if rw <= 1.0 or rh <= 1.0:
        return None
    rot_len = max(rw, rh)
    rot_thick = min(rw, rh)
    if rot_len < min_len or rot_thick > max_thick or rot_thick < 3.0:
        return None
    if (rot_len / rot_thick) < 2.05:
        return None
    rot_fill = area / (rw * rh)
    if rot_fill < 0.54:
        return None

    box = cv2.boxPoints(rect)  # 4x2 float32
    d01 = float(np.hypot(*(box[1] - box[0])))
    d12 = float(np.hypot(*(box[2] - box[1])))
    if d01 >= d12:
        mid_a = 0.5 * (box[0] + box[3])
        mid_b = 0.5 * (box[1] + box[2])
    else:
        mid_a = 0.5 * (box[0] + box[1])
        mid_b = 0.5 * (box[2] + box[3])

    dx = float(mid_b[0] - mid_a[0])
    dy = float(mid_b[1] - mid_a[1])
    if dx < 0 or (abs(dx) < 1e-4 and dy < 0):
        dx, dy = -dx, -dy
        mid_a, mid_b = mid_b, mid_a

    angle_deg = abs(math.degrees(math.atan2(dy, dx)))
    return _StripCandidate(
        cx=float(rcx),
        cy=float(rcy),
        length=float(rot_len),
        thickness=float(rot_thick),
        angle_deg=angle_deg,
        p1=(float(mid_a[0]), float(mid_a[1])),
        p2=(float(mid_b[0]), float(mid_b[1])),
        bbox=bbox,
    )


def _try_decompose_merged_L(
    comp_mask: np.ndarray,
    bx: int,
    by: int,
    min_len: float,
    max_thick: float,
) -> float | None:
    """If comp_mask is a merged L-shape (┌ └ ┐ ┘), return horizontal arm center Y in page px."""
    ch, cw = comp_mask.shape[:2]
    if ch < min_len * 0.85 or cw < min_len * 0.85:
        return None

    area = float(np.count_nonzero(comp_mask))
    bbox_fill = area / float(ch * cw)
    if bbox_fill < 0.08 or bbox_fill > 0.68:
        return None

    pad = max(6, int(0.18 * max(ch, cw)))
    padded = cv2.copyMakeBorder(
        comp_mask, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0
    )
    ph, pw = padded.shape[:2]
    center = (pw * 0.5, ph * 0.5)

    for deg in (0.0, -8.0, 8.0, -16.0, 16.0):
        if deg == 0.0:
            rot = padded
            inv_mat = None
        else:
            mat = cv2.getRotationMatrix2D(center, deg, 1.0)
            rot = cv2.warpAffine(
                padded, mat, (pw, ph), flags=cv2.INTER_NEAREST, borderValue=0
            )
            inv_mat = cv2.getRotationMatrix2D(center, -deg, 1.0)

        ys, xs = np.nonzero(rot)
        if xs.size == 0:
            continue
        span_w = int(xs.max() - xs.min() + 1)
        span_h = int(ys.max() - ys.min() + 1)
        if span_w < min_len * 0.85 or span_h < min_len * 0.85:
            continue

        kh_w = max(10, int(round(max(min_len * 0.72, span_w * 0.48))))
        kv_h = max(10, int(round(max(min_len * 0.72, span_h * 0.48))))
        h_open = cv2.morphologyEx(
            rot,
            cv2.MORPH_OPEN,
            cv2.getStructuringElement(cv2.MORPH_RECT, (kh_w, 3)),
        )
        v_open = cv2.morphologyEx(
            rot,
            cv2.MORPH_OPEN,
            cv2.getStructuringElement(cv2.MORPH_RECT, (3, kv_h)),
        )

        h_cnts, _ = cv2.findContours(h_open, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        v_cnts, _ = cv2.findContours(v_open, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not h_cnts or not v_cnts:
            continue

        hc = max(h_cnts, key=cv2.contourArea)
        vc = max(v_cnts, key=cv2.contourArea)
        hx, hy, hw, hh = cv2.boundingRect(hc)
        vx, vy, vw, vh = cv2.boundingRect(vc)

        if hw < min_len * 0.85 or vh < min_len * 0.85:
            continue
        if hh > max_thick or vw > max_thick:
            continue
        if (hw / max(1.0, float(hh))) < 1.95 or (vh / max(1.0, float(vw))) < 1.95:
            continue

        union_area = float(np.count_nonzero((h_open > 0) | (v_open > 0)))
        if union_area / max(1.0, area) < 0.60:
            continue

        # Verify L-corner geometry: vertical arm sits near left or right end of horizontal arm,
        # and horizontal arm sits near top or bottom end of vertical arm (UP or DOWN).
        vx_mid = vx + 0.5 * vw
        hy_mid = hy + 0.5 * hh
        x_end_dist = min(abs(vx_mid - hx), abs(vx_mid - (hx + hw)))
        y_end_dist = min(abs(hy_mid - vy), abs(hy_mid - (vy + vh)))
        corner_tol_x = max(vw * 1.9, hw * 0.36)
        corner_tol_y = max(hh * 1.9, vh * 0.36)
        if x_end_dist > corner_tol_x or y_end_dist > corner_tol_y:
            continue

        # Check the two arms actually meet/approach each other vertically & horizontally.
        if vx_mid < hx - vw * 1.5 or vx_mid > (hx + hw) + vw * 1.5:
            continue
        if hy_mid < vy - hh * 1.5 or hy_mid > (vy + vh) + hh * 1.5:
            continue

        h_cx = hx + 0.5 * hw
        h_cy = hy + 0.5 * hh
        if inv_mat is not None:
            pt = inv_mat @ np.array([h_cx, h_cy, 1.0], dtype=np.float64)
            h_cy = float(pt[1])

        page_horiz_y = by + (h_cy - pad)
        return float(page_horiz_y)

    return None


def detect_stickies(page_bgr: np.ndarray) -> list[DetectedMarker]:
    """Detect physical sticky markers (`L` single-paragraph vs `bar` range) on a single page."""
    h, w = page_bgr.shape[:2]
    if h < 40 or w < 40:
        return []

    short_side = float(min(h, w))
    min_len = max(16.0, 0.032 * short_side)
    max_thick = max(14.0, 0.105 * short_side)
    min_area = max(48.0, 0.00012 * h * w)

    mask = _build_sticky_mask(page_bgr)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)

    horiz_strips: list[_StripCandidate] = []
    vert_strips: list[_StripCandidate] = []
    markers: list[DetectedMarker] = []

    for label_idx in range(1, num_labels):
        bx = int(stats[label_idx, cv2.CC_STAT_LEFT])
        by = int(stats[label_idx, cv2.CC_STAT_TOP])
        bw = int(stats[label_idx, cv2.CC_STAT_WIDTH])
        bh = int(stats[label_idx, cv2.CC_STAT_HEIGHT])
        area = float(stats[label_idx, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        # Ignore full-frame border artifacts touching >= 92% of page width or height.
        if bw > 0.92 * w or bh > 0.92 * h:
            continue

        comp_mask = ((labels[by : by + bh, bx : bx + bw] == label_idx).astype(np.uint8)) * 255
        cnts, _ = cv2.findContours(comp_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        cnt = max(cnts, key=cv2.contourArea)
        cnt_shifted = cnt + np.array([[[bx, by]]], dtype=cnt.dtype)

        strip = _extract_strip_geometry(
            cnt_shifted, (bx, by, bw, bh), area, min_len=min_len, max_thick=max_thick
        )
        if strip is not None:
            if strip.angle_deg <= 32.0:
                horiz_strips.append(strip)
            elif strip.angle_deg >= 58.0:
                vert_strips.append(strip)
            continue

        horiz_y = _try_decompose_merged_L(
            comp_mask, bx=bx, by=by, min_len=min_len, max_thick=max_thick
        )
        if horiz_y is not None:
            y_norm = float(np.clip(horiz_y / float(h), 0.0, 1.0))
            x_norm = float(np.clip((bx + 0.5 * bw) / float(w), 0.0, 1.0))
            markers.append(
                DetectedMarker(
                    kind="L",
                    yNorm=round(y_norm, 4),
                    xNorm=round(x_norm, 4),
                    bbox=(
                        round(float(np.clip(bx / float(w), 0.0, 1.0)), 4),
                        round(float(np.clip(by / float(h), 0.0, 1.0)), 4),
                        round(float(np.clip(bw / float(w), 0.0, 1.0)), 4),
                        round(float(np.clip(bh / float(h), 0.0, 1.0)), 4),
                    ),
                )
            )

    # Pair separate horizontal & vertical strips meeting near an L corner (when slightly gapped).
    used_h: set[int] = set()
    used_v: set[int] = set()
    for hi, hs in enumerate(horiz_strips):
        best_vi: int | None = None
        best_dist = float("inf")
        for vi, vs in enumerate(vert_strips):
            if vi in used_v:
                continue
            max_gap = max(hs.thickness, vs.thickness) * 2.4 + 0.025 * short_side
            # Endpoint-to-endpoint or T-near-corner distance between H endpoints and V endpoints.
            corner_dists = [
                math.hypot(hp[0] - vp[0], hp[1] - vp[1])
                for hp in (hs.p1, hs.p2)
                for vp in (vs.p1, vs.p2)
            ]
            d_min = min(corner_dists)
            if d_min <= max_gap and d_min < best_dist:
                best_dist = d_min
                best_vi = vi
        if best_vi is not None:
            vs = vert_strips[best_vi]
            used_h.add(hi)
            used_v.add(best_vi)
            hx, hy, hw, hh = hs.bbox
            vx, vy, vw, vh = vs.bbox
            ux = min(hx, vx)
            uy = min(hy, vy)
            uw = max(hx + hw, vx + vw) - ux
            uh = max(hy + hh, vy + vh) - uy
            y_norm = float(np.clip(hs.cy / float(h), 0.0, 1.0))
            x_norm = float(np.clip((ux + 0.5 * uw) / float(w), 0.0, 1.0))
            markers.append(
                DetectedMarker(
                    kind="L",
                    yNorm=round(y_norm, 4),
                    xNorm=round(x_norm, 4),
                    bbox=(
                        round(float(np.clip(ux / float(w), 0.0, 1.0)), 4),
                        round(float(np.clip(uy / float(h), 0.0, 1.0)), 4),
                        round(float(np.clip(uw / float(w), 0.0, 1.0)), 4),
                        round(float(np.clip(uh / float(h), 0.0, 1.0)), 4),
                    ),
                )
            )

    # Remaining standalone horizontal strips are `bar` range markers.
    remaining_bars = [hs for idx, hs in enumerate(horiz_strips) if idx not in used_h]
    remaining_bars.sort(key=lambda s: (s.cy, s.cx))

    # Merge collinear fragments if ink split a single horizontal strip.
    merged_bars: list[_StripCandidate] = []
    for bar in remaining_bars:
        if not merged_bars:
            merged_bars.append(bar)
            continue
        prev = merged_bars[-1]
        bx1, by1, bw1, bh1 = prev.bbox
        bx2, by2, bw2, bh2 = bar.bbox
        same_row = abs(bar.cy - prev.cy) <= max(prev.thickness, bar.thickness) * 0.95
        horiz_gap = max(0, max(bx1, bx2) - min(bx1 + bw1, bx2 + bw2))
        if same_row and horiz_gap <= max(prev.thickness, bar.thickness) * 1.6:
            ux = min(bx1, bx2)
            uy = min(by1, by2)
            uw = max(bx1 + bw1, bx2 + bw2) - ux
            uh = max(by1 + bh1, by2 + bh2) - uy
            merged_bars[-1] = _StripCandidate(
                cx=ux + 0.5 * uw,
                cy=0.5 * (prev.cy + bar.cy),
                length=float(uw),
                thickness=max(prev.thickness, bar.thickness),
                angle_deg=0.5 * (prev.angle_deg + bar.angle_deg),
                p1=prev.p1,
                p2=bar.p2,
                bbox=(ux, uy, uw, uh),
            )
        else:
            merged_bars.append(bar)

    for bar in merged_bars:
        bx, by, bw, bh = bar.bbox
        y_norm = float(np.clip(bar.cy / float(h), 0.0, 1.0))
        x_norm = float(np.clip(bar.cx / float(w), 0.0, 1.0))
        markers.append(
            DetectedMarker(
                kind="bar",
                yNorm=round(y_norm, 4),
                xNorm=round(x_norm, 4),
                bbox=(
                    round(float(np.clip(bx / float(w), 0.0, 1.0)), 4),
                    round(float(np.clip(by / float(h), 0.0, 1.0)), 4),
                    round(float(np.clip(bw / float(w), 0.0, 1.0)), 4),
                    round(float(np.clip(bh / float(h), 0.0, 1.0)), 4),
                ),
            )
        )

    markers.sort(key=lambda m: (m.yNorm, m.xNorm))
    return markers
