# Book Highlighter

A personal reader for the book summaries and highlights you capture from your
physical books. Photograph a book's table of contents and its sticky-note
flagged pages to extract chapters, printed page numbers, and multi-paragraph
highlights on-device, and read them like a pocket edition with horizontal slide
or continuous scroll across five reading themes (including an illustrated
`Book` theme with cover-derived chromatic accents and botanical ornaments) — or
export a book or the whole shelf as a selectable vector PDF in `A5`, `B5`,
`A4`, or `Letter`. Your library is yours alone: there is no social layer, and
nothing you capture or write is shared with or shown to anyone else.

It is a React and Vite web app and installable offline-first PWA, sharing the
same Firebase (Auth + Firestore), Cloudinary, and web UI foundation as Sound
Shaper.

- **Web:** [bookhighlighter.juanevillam.com](https://bookhighlighter.juanevillam.com)
- **Support:** [juanevillam.com/book-highlighter/support](https://juanevillam.com/book-highlighter/support)
- **Privacy policy:** [juanevillam.com/book-highlighter/privacy-policy](https://juanevillam.com/book-highlighter/privacy-policy)

## Layout

| path           | what it is                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/screens`  | the two root screens: `Welcome` and `Home` (3-column desktop stage, mobile shelf and sheets)                                                                                                                                 |
| `src/ui`       | the UI kit — shelf grid, book stage, reader (`Reader.tsx`), chapter/highlight photo editors, sheets, trophies, and `StateLab`                                                                                                |
| `src/lib`      | on-device neural OCR & sticky-note highlight detector (`ocr/`, `photoImport/`), pagination (`paginator.ts`), vector PDF export (`pdfExport.ts`), reader sections and themes, cover palette extraction, shelf sorting, genres |
| `src/store`    | persisted stores for books, on-demand book bodies, shelf sort, and per-device reader settings                                                                                                                                |
| `src/trophies` | the PlayStation-style trophy engine and its banner                                                                                                                                                                           |
| `src/i18n`     | translations (`en`, `es`, `zh`)                                                                                                                                                                                              |
| `public/`      | PWA manifest (`manifest.webmanifest`), offline Service Worker (`sw.js`), ONNX OCR models (`models/`), icons, and Cloudflare Pages `_headers`                                                                                 |
| `scripts/`     | local Firebase environment setup helper (`setup-firebase.sh`) and CLI photo pipeline evaluator (`eval-photos.ts`)                                                                                                            |
| `test/`        | unit tests for pagination, body edits, shelf sorting, and reader anchors                                                                                                                                                     |

Book Highlighter is a standalone web-first repository inside the portfolio,
sharing the web UI language, tokens, and account/trophy plumbing of Sound
Shaper's `web/` app.

## Develop

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

Firebase's client config (`src/firebaseConfig.ts`) is committed — it identifies
the project and is public by design; access is enforced by `firestore.rules`
and Firebase App Check. Cover deletions run through the `book-highlighter`
environment of the portfolio's Cloudflare `media-worker` (which holds the
Cloudinary API secret).

## Two documents per book and client-side typesetting

Each book is split across two Firestore documents: `users/{uid}/books/{id}`
holds lightweight metadata (title, author, year, genres, series, cover, and
denormalized chapter/highlight counts) for the single session listener that
draws the shelf, while `users/{uid}/bodies/{id}` holds the long text (summary,
chapters, and highlights) and is read on demand and cached in IndexedDB.

The reader (`src/lib/paginator.ts`) and the PDF exporter (`src/lib/pdfExport.ts`)
measure and paginate sections in the browser: the reader tracks reading position
by a character-offset anchor (`readerAnchor`) rather than a screen page number
so resizing or changing text scale never loses your place, and PDF export draws
vector glyphs onto `A5`, `B5`, `A4`, or `Letter` pages so exported books stay
selectable and searchable.

## Standards

[`AGENTS.md`](AGENTS.md) is the product and engineering record: what a book is,
how the neural photo pipeline, shelf, reader, and PDF exporter work, and the
house UI and release rules they follow.

## License

All rights reserved — see [`LICENSE`](LICENSE). The source is public to read;
it is not licensed for reuse or redistribution.
