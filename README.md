# Book Highlighter

Scan physical sticky-note highlights straight from a real book and read them offline like a pocket edition.

Live at **[bookhighlighter.juanevillam.com](https://bookhighlighter.juanevillam.com)** — installable **PWA** (`100%` web).

- **Web:** [bookhighlighter.juanevillam.com](https://bookhighlighter.juanevillam.com)
- **Support:** [juanevillam.com/book-highlighter/support](https://juanevillam.com/book-highlighter/support)
- **Privacy policy:** [juanevillam.com/book-highlighter/privacy-policy](https://juanevillam.com/book-highlighter/privacy-policy)

## Highlights

- **On-Device Photo Scanner (`src/lib/ocr/`, `src/lib/photoImport/`)**: Upload photos of a physical book in order (cover, highlighted pages from start to end, and the table of contents). A 100% browser-based Web Worker pipeline (PaddleOCR `det` + `rec-latin` on ONNX Runtime Web + HSV margin sticky-flag detector):
  - **Automatic deskew & single-page column isolation**: straightens tilted photos and isolates the active page from the neighboring spread page.
  - **Sticky-flag range pairing**: detects sticky flags lying on the active page's outer margin, repairs missing or misread page numbers from sequential neighbors, and pairs opening/closing flags across multi-page highlights.
  - **Table of Contents & Cover extraction**: extracts chapters with their page numbers from the `ÍNDICE` photo and files each highlight under its chapter automatically.
  - **Interactive per-photo line inspector**: lets you inspect each uploaded page photo with overlaid text lines and tap any line to move where a highlight starts or ends.
- **Kindle-Grade Reader**: Double-sided interactive page curl (`curl`), horizontal `slide`, and continuous `scroll` modes across 4 themes (`Light`, `Dark`, `Sepia`, `Paper`), 6 text scales, `Contents` TOC, and character-offset `readerAnchor` reflow persistence.
- **6 × 9 in Searchable PDF Export**: Trade-book typesetting (`This Book` or `All Books`) with cover, title card, summary, chapters, quoted highlights, and page references.
- **Offline-First PWA**: Service Worker App Shell + cover caching paired with Firestore IndexedDB `persistentLocalCache`.

## Quick Start

```bash
npm install
cp .env.example .env.local   # or run ./scripts/setup-firebase.sh
npm run dev
```

## Verification

```bash
npm run typecheck
npm test
npm run build
```

## License

All rights reserved — see [`LICENSE`](LICENSE). The source is public to read;
it is not licensed for reuse or redistribution.
