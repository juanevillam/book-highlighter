# Book Highlighter

Scan physical sticky-note highlights straight from a real book and read them offline like a pocket edition.

Live at **[bookhighlighter.juanevillam.com](https://bookhighlighter.juanevillam.com)** — installable **PWA** (`100%` web).

## Highlights

- **Physical Sticky-Line Camera Scanner (`scanner/`)**: Flip through an entire physical book in front of your camera. A two-stage OpenCV + Vision/OCR pipeline detects translucent sticky strips on left or right margins in any color:
  - **`L` corner marker** (horizontal + vertical strip): extracts that exact paragraph or meditation with its page number.
  - **Horizontal `bar` marker**: opens and closes single-page or multi-page highlight ranges (`p. 23–27`), automatically capturing full continuation pages in between and warning if a page was skipped.
  - **Zero video/photo storage**: frames live only in RAM during extraction and are discarded immediately; Firestore stores pure text and Cloudinary stores only book covers.
- **Kindle-Grade Reader**: Double-sided interactive page curl (`curl`), horizontal `slide`, and continuous `scroll` modes across 4 themes (`Light`, `Dark`, `Sepia`, `Paper`), 6 text scales, `Contents` TOC, and character-offset `readerAnchor` reflow persistence.
- **6 × 9 in Searchable PDF Export**: Trade-book typesetting (`This Book` or `All Books`) with cover, title card, summary, chapters, quoted highlights, and page references.
- **Offline-First PWA**: Service Worker App Shell + cover caching paired with Firestore IndexedDB `persistentLocalCache`.

## Quick Start

### 1. Web App

```bash
npm install
cp .env.example .env.local   # or run ./scripts/setup-firebase.sh
npm run dev
```

### 2. Python Book Scanner (`scanner/`)

```bash
cd scanner
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8787 --reload
```

Set `GEMINI_API_KEY` for `gemini-2.5-flash` structured Vision extraction, or run completely offline with the automatic `RapidOCR` ONNX fallback.

## Verification

```bash
npm run typecheck
npm test
npm run build
scanner/.venv/bin/pytest
```
