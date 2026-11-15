# Book Highlighter

> **WEB ONLY (Juan, 2026-11-10).** Book Highlighter is the standalone web +
> installable PWA evolution of the portfolio's `apps/booker` (whose native iOS
> app stays frozen in the private monorepo). It runs at
> https://bookhighlighter.juanevillam.com, deployed on Cloudflare Pages
> (`bookhighlighter`).

A **personal reader for the book summaries and highlights Juan writes himself** —
not an e-book store and not an AI product; there is no AI or OCR in it. You add
a book, write an optional summary in your own words, and organize chapters and
highlights with the printed edition's page numbers as written, then read them
like a pocket edition or export them as a 6 × 9 in trade-paperback PDF.

**Personal-only, like Sound Shaper.** No social surface, ever. Every book and
highlight belongs to the signed-in reader alone.

## Working in this repo

- **Commit directly on `main`**, logical conventional-commit chunks, don't push
  unless asked. **`git commit` hangs silently** unless the SSH signing key is
  loaded — check `ssh-add -l` first; never `--no-gpg-sign`.
- **Scripts:** `npm run dev`, `npm run typecheck` (`tsc --noEmit`),
  `npm test` (`vitest run`), `npm run build` (`tsc --noEmit && vite build`).
- **Offline-first PWA:** Unlike Sound Shaper Web (which streams audio and
  unregisters Service Workers), Book Highlighter ships `public/manifest.webmanifest`
  and `public/sw.js` paired with Firestore's IndexedDB `persistentLocalCache`,
  so a shelf installed to the iPhone Home Screen opens and reads offline like a
  Kindle.

## Versions

**Tags and GitHub Releases mark real product milestones — NEVER every push**
(Juan, 2026-11-13). `package.json`'s `version` is the product's (`v1.0.0` at
launch) and follows the same disciplined cadence as Sound Shaper and
`juanevillam.com`.

- **Day-to-day pushes take NO version bump and NO tag.** Push normal fixes, copy
  tweaks, layout adjustments, and small improvements directly to `main`.
- **Cut a release only at a true milestone or when Juan explicitly asks.** When
  cutting a release: bump `version` in a `chore(release): vX.Y.Z` commit, tag
  THAT commit (`git tag -m "vX.Y.Z" vX.Y.Z`), push `main` and the tag together,
  and create a GitHub Release with concise user-facing `•` bullets (`/release-notes`).
- **Format — identical across the portfolio:** tag name `vX.Y.Z`; tag message
  just `vX.Y.Z`; Release title `vX.Y.Z`.

## What a book is

| field    | code                      | rendered (en)         | notes                                       |
| -------- | ------------------------- | --------------------- | ------------------------------------------- |
| title    | `name`                    | Title                 | `name`, matching Sound Shaper and Topper    |
| author   | `author`                  | Author                | one string, kept as written                 |
| year     | `year`                    | Year                  | drives "Publication Date"; may be `< 0`     |
| series   | `series` / `seriesNumber` | Series / Book #       | optional; stacks books sharing a series     |
| genres   | `genres: string[]`        | Genre                 | multi-select from `src/lib/genres.ts`       |
| summary  | `body.summary`            | Summary               | optional; paragraphs split on line breaks   |
| chapters | `body.chapters[]`         | Chapters / Highlights | each: `id`, `name`, `pages`, `highlights[]` |
| cover    | `artUrl` / `artPublicId`  | Cover                 | 2:3 cover uploaded to Cloudinary            |

- **One prose field and one editor.** The book editor holds the metadata, cover,
  and `summary`; `ChaptersForm` holds the chapters and their highlights.
- **Two documents per book:** `users/{uid}/books/{id}` (metadata — the ONE
  session listener) and `users/{uid}/bodies/{id}` (the long text — read on
  demand and cached in `src/store/bodies.ts` + IndexedDB). Counts the shelf
  needs (`chapterCount`, `highlightCount`) are denormalized onto the book on
  every body save, which also drives the trophy engine from the single listener.
- **Pages are the printed edition's, as written — text, not numbers.**
  `chapter.pages` holds the printed span (e.g. `"14–33"` or `"pág. 14, 33 y 95"`),
  and `highlight.page` holds the passage's page (`"47"` or `"47–48"`), optional
  always. Neither is a screen page number.
- **The reader's place is an anchor** (`readerAnchor: { blockId, offset }`),
  never a page number. Screen pages change with text scale, viewport size, and
  rotation; the character-offset anchor keeps the exact paragraph in view.

## On-device neural highlight & TOC detector (`src/lib/ocr/`, `src/lib/photoImport/`)

- **100% in-browser Web Worker (`onnxruntime-web/wasm`) + sequential job queue:**
  Static PaddleOCR v3 ONNX models (`public/models/det.onnx` +
  `public/models/rec-latin.onnx` + `public/models/rec-latin.txt`, cached with
  `Cache-Control: immutable`) run off the main thread in a warm singleton
  Web Worker (`src/lib/photoImport/client.ts` + `worker.ts`). Zero server cost,
  offline-ready, and no third-party LLM copyright refusals.
- **Curved-page line unwarping (`detCurvedBoxes` + `sampleWarpedLineChw`):**
  Open books photographed in hand curve non-uniformly from top to bottom. Rather
  than cropping axis-aligned bounding boxes (which swallow adjacent lines on
  tilted pages), `paddle.ts` tracks each text line's per-column centerline
  `yc(x)` and local stroke height `medH`, unwarping each curved line into a flat
  48 px strip before recognition, and pools split diacritic probabilities plus
  soft-token CTC thresholds (`pBlank < 0.68` for spaces and punctuation).
- **Paper Sandwich sticky-note detector (`findFlags` in `analyze.ts`):**
  Detects sticky flags of any hue inside the current page's outer margin strip
  (`0.006 * W` to `0.038 * W` outside the text column) by requiring a
  high-saturation band (`rowS >= 80 && rowV >= 110`) sandwiched between bare
  low-saturation paper both above and below (`aboveS < 42 && belowS < 42`). This
  rejects both background tabs sticking out past the page edge and thumbs
  holding the bottom corner. Distinguishes horizontal `'bar'` flags (range
  start/end) from vertical `'L'` flags (single-paragraph mark).
- **5-signal paragraph reconstruction & TOC extraction (`assemble.ts`):**
  Reconstructs paragraph breaks across `1..N` photos of a highlight from (1)
  first-line indent (`> 0.65 * lh`, excluding right-aligned hanging verse
  continuations), (2) short previous line ("punto y aparte sin sangría"), (3)
  vertical block gap, (4) dialogue em-dash (`—`), and (5) cross-line/cross-page
  hyphenation, paired with an interactive per-photo line inspector in
  `ChaptersForm.tsx` and TOC (`ÍNDICE`) photo scanning.

## Library & shelf

- **Sort** (`src/lib/librarySort.ts`): `Recent` (last opened), `Title`,
  `Author`, `Publication Date`, each with ascending/descending order, persisted
  per device in `src/store/librarySort.ts`.
- **No hand order.** A music library is arranged by hand; a bookshelf is browsed
  by these four sorts.
- **Series stack into one tile** (`src/lib/shelf.ts`). Books sharing a `series`
  name stack into a fan tile at the position of the series' first book in the
  active sort; opening it shows the series ordered by `seriesNumber`.
- **Genres are a translated catalogue** (`src/lib/genres.ts`, translated under
  `genres.*` in `en`, `es`, `zh`), multi-select and searchable.
- **Recently Deleted:** Deleting a book soft-deletes it (`trashedAt`) with an
  Undo toast; `TrashSheet` (reached from Account) offers Recover or Delete
  Permanently.

## The reader (`src/ui/Reader.tsx`, `src/lib/paginator.ts`)

- **Reading order:** Cover (if present) → interior title page → `Summary` → each
  chapter that has highlights, with highlights set in typographic quotes (`“…”`).
- **Three page-turn modes (`PAGE_TURNS`):**
  - `curl`: interactive double-sided page curl showing the mirrored back of the
    turning leaf over the active paper tone.
  - `slide`: horizontal paginated swipe/keyboard step.
  - `scroll`: continuous vertical column with the top bar pinned and page
    footers omitted.
- **Four page themes (`READER_THEMES`):** `light` (`#FFFFFF`), `dark`
  (`#000000`), `sepia` (`#F3E9D2`), and `paper` (`#CFCFCB`), or `null` to follow
  the app appearance.
- **Six text scales (`TEXT_SCALES`):** `0.7`, `0.8`, `0.9`, `1.0`, `1.1`, `1.2`,
  shared between the screen reader and PDF export.

## Export (PDF — `src/lib/pdfExport.ts`, `src/ui/ExportForm.tsx`)

- **Client-side vector PDF (`6 × 9 in` trade paperback):** Generated in the
  browser with `jspdf` for `This Book` or `All Books`. Text is drawn as
  selectable, searchable glyphs rather than rasterized images.
- **Order:** Front cover with title, author, year, and genres (or title page if
  there is no cover) → `Summary` → chapters and quoted highlights, seeded with
  the reader's current theme and text scale.

## UI & craft rules

- **Same visual DNA as `soundshaper.juanevillam.com`:** Dark-first monochrome
  surfaces (`#0d0d0d` dark / `#f2f2f7` light), 4-tier ink hierarchy, Liquid
  Glass floating bars with a tonal floor, circular lone-glyph controls vs pill
  text controls, and tactile `:active` press squash.
- **Responsive stage:** On desktop (`>= 64rem`), up to three columns sit side by
  side (`LibraryGrid` → `BookStage` → `SidePanel`); on mobile (`< 64rem`), a
  2-column 2:3 cover grid pairs with full-height sheets.
- **Trophies (`src/trophies/`):** 7 PlayStation-tier trophies (`Book Highlighter`
  platinum, `Rereader`, `Marker`, `Shelver`, `Writer`, `Binder`, `Finisher`),
  with titles always kept in English across all UI languages.
