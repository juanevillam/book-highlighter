# Book Highlighter — Scanner Microservice

Zero-storage, in-RAM Python FastAPI microservice that turns a live phone or laptop camera walk through a physical book into structured chapter-grouped highlights using physical sticky-strip grammar.

## Highlights & Guarantees

- **Zero Disk / Zero Cloud Media Storage:** Every uploaded frame is decoded directly from `bytes` via `np.frombuffer` + `cv2.imdecode` in RAM and discarded immediately after extraction. No `/tmp` files, no buckets, no persistent database.
- **Physical Sticky-Line Grammar (`sticky_detector.py`):**
  - **`L` (Single-paragraph / single-meditation highlight):** One horizontal sticky strip + one vertical sticky strip meeting near a corner (vertical strip going UP or DOWN, on left or right margin, any neon or pastel color). Captures **only** the single paragraph aligned with the `L`'s horizontal strip.
  - **`bar` (Range highlight):**
    - `2` horizontal bars on the same page (`y_top < y_bottom`) → intra-page range `[y_top, y_bottom]`.
    - `1` horizontal bar when `openRange` is inactive → opens cross-page range `[y_bar, bottom]`.
    - `0` bars when `openRange` is active → full-page continuation (excluding headers/footers) + skipped-page gap detection (`"Faltan las páginas 24–25 del rango abierto en pág. 23"`).
    - `1` horizontal bar when `openRange` is active → closes cross-page range `[top, y_bar]`, de-hyphenating words across line and page breaks (`"progra-\nmación"` → `"programación"`) and recording typographic en-dash page spans (`"23–27"`).
- **2-Stage Fast Filter + Hybrid OCR (`ocr_engine.py`):**
  - **Stage 1 (< 35 ms OpenCV):** Detects sticky markers first; on unmarked pages outside an active range, runs a fast typographic layout check and skips plain body pages without running OCR.
  - **Stage 2:** Uses `gemini-2.5-flash` (`google-genai`) structured JSON extraction when `GEMINI_API_KEY` is set, with automatic offline fallback to `rapidocr-onnxruntime`.

## Local Development

```bash
cd scanner
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt

# Start server on http://localhost:8080
.venv/bin/uvicorn server:app --reload --port 8080

# Run test suite
.venv/bin/pytest
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `ALLOWED_ORIGINS` | `https://bookhighlighter.juanevillam.com,http://localhost:5173,http://127.0.0.1:5173` | Comma-separated CORS origins |
| `GEMINI_API_KEY` | *(unset)* | Optional Gemini API key (`hybrid` / `gemini` Stage 2 vision OCR) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model identifier |
| `OCR_BACKEND` | `hybrid` | `hybrid`, `gemini`, or `rapidocr` |
| `FIREBASE_PROJECT_ID` | *(unset)* | Firebase project ID for RS256 Bearer token verification |
| `ALLOW_DEV_UNAUTH` | `1` when `FIREBASE_PROJECT_ID` is empty, else `0` | Allow unauthenticated requests in local development |
