# Book Highlighter

Your book summaries and highlights, on a shelf — read them like a pocket edition, chapter by chapter, with their pages.

Live at **[bookhighlighter.juanevillam.com](https://bookhighlighter.juanevillam.com)** — installable **PWA** (`100%` web).

- **Web:** [bookhighlighter.juanevillam.com](https://bookhighlighter.juanevillam.com)
- **Support:** [juanevillam.com/book-highlighter/support](https://juanevillam.com/book-highlighter/support)
- **Privacy policy:** [juanevillam.com/book-highlighter/privacy-policy](https://juanevillam.com/book-highlighter/privacy-policy)

## Highlights

- **Shelf & Series Stacking**: 2:3 book covers, series fan stacks, 4 sort modes (`Recent`, `Title`, `Author`, `Publication Date`) with ascending/descending order, and 3-column desktop stage (`Library` → `Book Stage` → `Side Sheets`).
- **Chapters & Highlights**: Organize chapters with their printed page numbers as written, add and reorder highlights with their page references, and write an optional summary in your own words.
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
