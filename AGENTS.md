# Book Highlighter

> **WEB ONLY (Juan, 2026-11-10).** Book Highlighter is a 100% web and
> installable offline-first PWA product — it has no native mobile app. It runs
> at https://bookhighlighter.juanevillam.com, deployed on Cloudflare Pages
> (`bookhighlighter`).

A **personal reader for the book summaries and highlights Juan captures from his
physical books** — not an e-book store and not a cloud AI product. You add a
book, write an optional summary in your own words, photograph the printed table
of contents (`ÍNDICE`) and sticky-note flagged pages so the on-device neural
pipeline extracts chapters, printed page numbers, and multi-paragraph highlights
automatically, then read them like a pocket edition or export them as a
searchable vector PDF.

**Personal-only, like Sound Shaper.** No social surface, ever. Every book and
highlight belongs to the signed-in reader alone.

## Working in this repo

- **Commit directly on `main`**, logical conventional-commit chunks, don't push
  unless asked. **`git commit` hangs silently** unless the SSH signing key is
  loaded — check `ssh-add -l` first; never `--no-gpg-sign`.
- **Scripts:** `npm run dev`, `npm run typecheck` (`tsc --noEmit`),
  `npm test` (`vitest run`), `npm run build` (`tsc --noEmit && vite build`),
  `npm run eval:photos` (`tsx scripts/eval-photos.ts`).
- **Offline-first PWA:** Book Highlighter ships `public/manifest.webmanifest`
  and `public/sw.js` paired with Firestore's IndexedDB `persistentLocalCache`,
  so a shelf installed to the iPhone Home Screen or desktop opens and reads
  offline like a Kindle.
- **Shared web UI primitives:** `ActionSheet.tsx`, `Artwork.tsx`, `Backdrop.tsx`,
  `ConfirmDialog.tsx`, `SidePanel.tsx`, `StateLab.tsx`, and `Toast.tsx` are kept
  byte-for-byte identical with `sound-shaper/web` (`npm run check:web-ui` in the
  root portfolio repo).

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
| title    | `name`                    | Title                 | `name`, matching Sound Shaper               |
| author   | `author`                  | Author                | one string, kept as written                 |
| year     | `year`                    | Year                  | drives "Publication Date"; may be `< 0`     |
| series   | `series` / `seriesNumber` | Series / Book #       | optional; stacks books sharing a series     |
| genres   | `genres: string[]`        | Genre                 | multi-select from `src/lib/genres.ts`       |
| summary  | `body.summary`            | Summary               | optional; paragraphs split on line breaks   |
| chapters | `body.chapters[]`         | Chapters / Highlights | each: `id`, `name`, `pages`, `highlights[]` |
| cover    | `artUrl` / `artPublicId`  | Cover                 | 2:3 cover uploaded to Cloudinary            |

- **One prose field and photo-driven chapters/highlights.** The book editor
  holds the metadata, cover, and `summary`; `ChaptersForm` holds the chapters
  and their highlights, populated from photos of the book's table of contents
  and flagged pages (including automatic chapter creation/routing for books
  without a printed index).
- **Two documents per book:** `users/{uid}/books/{id}` (metadata — the ONE
  session listener) and `users/{uid}/bodies/{id}` (the long text — read on
  demand and cached in `src/store/bodies.ts` + IndexedDB). Counts the shelf
  needs (`chapterCount`, `highlightCount`) are denormalized onto the book on
  every body save, which also drives the trophy engine from the single listener.
- **Pages are the printed edition's, as written — text, not numbers.**
  `chapter.pages` holds the printed span (e.g. `"14–33"`), and `highlight.page`
  holds the passage's page (`"47"` or `"47–48"`), optional always. Neither is a
  screen page number.
- **The reader's place is an anchor** (`readerAnchor: { blockId, offset }`),
  never a page number. Screen pages change with text scale, page width, viewport
  size, and rotation; the character-offset anchor keeps the exact paragraph in
  view.

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
  Detects sticky flags of any hue (neon, pastel, teal, or neutral/translucent)
  inside the current page's outer margin strip (`0.006 * W` to `0.038 * W`
  outside the text column) by requiring a distinct flag band sandwiched between
  bare paper both above and below. This rejects both background tabs sticking
  out past the page edge and thumbs holding the bottom corner. Distinguishes
  horizontal `'bar'` flags (range start/end) from vertical `'L'` flags
  (single-paragraph mark where the horizontal `IN + MID` arm marks the start and
  the paragraph break closes the passage).
- **5-signal paragraph reconstruction & TOC extraction (`assemble.ts`):**
  Reconstructs paragraph breaks across `1..N` photos of a highlight from (1)
  first-line indent (`> 0.65 * lh`, excluding right-aligned hanging verse
  continuations), (2) short previous line ("punto y aparte sin sangría"), (3)
  vertical block gap, (4) dialogue em-dash (`—`), and (5) cross-line/cross-page
  hyphenation, paired with an interactive per-photo line inspector (`Reset Auto`
  to restore automatic marks) and TOC (`ÍNDICE`) photo scanning.

## Library & shelf

- **2D fractional hand order** (`src/lib/gridOrder.ts`):
  long-press/drag 2D fractional reordering across the shelf, including the
  draggable `+` add tile (`addTilePosition` on `users/{uid}`, cached per account
  in `localStorage['bookhighlighter.addTilePos.' + uid]`).
- **Series stack into one tile** (`src/lib/shelf.ts`). Books sharing a `series`
  name stack into a fan tile at the position of the series' first book; opening
  it shows the series ordered by `seriesNumber`.
- **Genres are a translated catalogue** (`src/lib/genres.ts`, translated under
  `genres.*` in `en`, `es`, `zh`), multi-select and searchable.
- **Direct deletion with confirmation:** Deleting a book confirms with a modal
  dialog (`ConfirmDialog`) and permanently deletes the Firestore documents and
  Cloudinary cover asset (`deleteBook`).

## The reader (`src/ui/Reader.tsx`, `src/lib/paginator.ts`)

- **Reading order (`src/lib/readerSections.ts`):** Typographic title card with
  cover art (`title`) → interactive book index (`book-index`, jumping to the
  chapter or opening photo upload if empty) → `Summary` → each chapter with its
  highlights and page citations → farewell colophon (`end`).
- **Two page-turn modes (`PAGE_TURNS`):**
  - `slide` (default): horizontal paginated swipe and keyboard step.
  - `scroll`: continuous vertical column with page footers omitted.
- **Five page themes (`READER_THEMES`):** `light` (`#FFFFFF`), `dark`
  (`#0D0D0D`), `sepia` (`#F3E9D2`), `paper` (`#CFCFCB`), and `book` (`#FAF6EE`
  light / `#141210` dark with cover-extracted chromatic accents, hand-drawn
  botanical header/footer ornaments `BookPageOrnament`, and margin illustrations
  `BookPageMarginArt`), or `null` to follow the app appearance.
- **Seven text scales (`TEXT_SCALES`) & two page widths (`PAGE_WIDTHS`):**
  `0.76`, `0.84`, `0.92`, `1.0` (default), `1.1`, `1.22`, `1.36`, plus
  `standard` and `extended` column widths, shared with PDF export.

## Export (PDF — `src/lib/pdfExport.ts`, `src/ui/ExportForm.tsx`)

- **Client-side vector PDF (`A5`, `B5`, `A4`, `Letter`):** Generated in the
  browser with `jspdf` for `This Book` or `All Books`. Text is drawn as
  selectable, searchable glyphs (with high-DPI Canvas fallback for CJK lines).
- **Order:** Cover page (when cover art exists) → interior title page →
  interactive outline & contents → `Summary` → chapters and highlights, seeded
  with the reader's current theme (including `book` ornaments and borders), text
  scale, and paper format.

## UI & craft rules

- **Same visual DNA as `soundshaper.juanevillam.com`:** Dark-first monochrome
  surfaces (`#0d0d0d` dark / `#f2f2f7` light), 4-tier ink hierarchy, Liquid
  Glass floating bars with a tonal floor, circular lone-glyph controls vs pill
  text controls, and tactile `:active` press squash.
- **Responsive stage:** On desktop (`>= 64rem`), up to three columns sit side by
  side (`LibraryGrid` → `BookStage` → `SidePanel`), with global centered modal
  sheets (`.modals`) for Settings, Account, Trophies, Series, and
  New/Edit Book; on mobile (`< 64rem`), a 2-column 2:3 cover grid pairs with
  full-height swipe-to-dismiss sheets.
- **Trophies (`src/trophies/`):** 7 PlayStation-tier trophies (`Book Highlighter`
  platinum, `Rereader`, `Marker`, `Shelver`, `Writer`, `Binder`, `Finisher`),
  with titles always kept in English across all UI languages.
