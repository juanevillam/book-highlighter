import { useEffect, useState } from 'react';

import { track } from '../analytics';
import { useScheme } from '../appearance';
import { EMPTY_BODY, type Book } from '../books';
import { t } from '../i18n';
import { CheckGlyph, CloseGlyph } from './glyphs';
import { BookPageEdgeMotif, BookPageOrnament } from './Reader';
import { SidePanel } from './SidePanel';
import { showToast } from './Toast';
import { loadCoverPalette, useBookCoverPalette } from '../lib/coverPalette';
import {
  bookOrnamentForSlot,
  bookPairForSlot,
  hashArtSeed,
} from '../lib/paginator';
import {
  effectiveTheme,
  PDF_FORMAT_IDS,
  PDF_FORMATS,
  READER_THEMES,
  readerPalette,
  TEXT_SCALES,
  type ReaderTheme,
} from '../lib/readerThemes';
import { useBodiesStore } from '../store/bodies';
import { selectShelf, useBooksStore } from '../store/books';
import { useReaderSettingsStore } from '../store/readerSettings';

export function ExportPanel({
  open,
  switching = false,
  depth = 0,
  index = 0,
  initialBook,
  onClose,
}: {
  open: boolean;
  switching?: boolean;
  depth?: number;
  index?: number;
  /** When null, opened from Account -> "Export All Books". */
  initialBook: Book | null;
  onClose: () => void;
}) {
  const scheme = useScheme();
  const books = useBooksStore(state => state.books);
  const ensureBody = useBodiesStore(state => state.ensure);

  const savedReaderTheme = useReaderSettingsStore(state => state.theme);
  const savedScaleIndex = useReaderSettingsStore(state => state.scaleIndex);
  const format = useReaderSettingsStore(state => state.pdfFormat);
  const setFormat = useReaderSettingsStore(state => state.setPdfFormat);

  const [scope, setScope] = useState<'book' | 'all'>(
    initialBook ? 'book' : 'all',
  );
  const [chosenTheme, setChosenTheme] = useState<ReaderTheme>(
    effectiveTheme(savedReaderTheme, scheme),
  );
  const [scaleIndex, setScaleIndex] = useState<number>(savedScaleIndex);
  const [busy, setBusy] = useState(false);

  const shelf = selectShelf({ books });
  const targetBooks = scope === 'book' && initialBook ? [initialBook] : shelf;
  const previewBook = initialBook ?? shelf[0] ?? null;
  const previewEntry = useBodiesStore(state =>
    previewBook ? state.entries[previewBook.id] : undefined,
  );
  const previewBody = previewEntry?.body ?? EMPTY_BODY;

  useEffect(() => {
    if (previewBook) {
      void ensureBody(previewBook.id).catch(() => {});
    }
  }, [previewBook, ensureBody]);

  const coverPalette = useBookCoverPalette(
    previewBook?.artUrl,
    previewBook ? `${previewBook.id}:${previewBook.name}` : '',
  );
  const activePalette = readerPalette(chosenTheme, coverPalette, scheme);
  const fontScale = TEXT_SCALES[scaleIndex] ?? 1;
  const previewArtSeed = hashArtSeed(
    previewBook?.id || previewBook?.name || 'export',
  );
  const previewRightMotif = bookPairForSlot(previewArtSeed, 0) * 2 + 1;
  const previewHeaderOrnament = bookOrnamentForSlot(previewArtSeed, 1);
  const previewFooterOrnament = bookOrnamentForSlot(previewArtSeed, 2);

  const firstPopulatedChapter = previewBody.chapters.find(
    ch => ch.highlights.length > 0,
  );
  const sampleChapterTitle =
    firstPopulatedChapter?.name ||
    previewBody.chapters[0]?.name ||
    previewBook?.name ||
    t('app.title');
  const sampleHighlightText =
    firstPopulatedChapter?.highlights[0]?.text ||
    (previewBook?.author
      ? t('reader.by', { author: previewBook.author })
      : t('welcome.features.read.subtitle'));
  const samplePageRef = firstPopulatedChapter?.highlights[0]?.page
    ? t('chapter.page', { page: firstPopulatedChapter.highlights[0].page })
    : t('chapter.page', { page: '14' });

  const handleExport = async () => {
    if (busy || targetBooks.length === 0) return;
    setBusy(true);
    try {
      const [{ generateBookPdfs, shareOrDownloadPdfs }, items] =
        await Promise.all([
          import('../lib/pdfExport'),
          Promise.all(
            targetBooks.map(async b => {
              const [body, bookCoverPal] = await Promise.all([
                ensureBody(b.id),
                loadCoverPalette(b.artUrl, `${b.id}:${b.name}`),
              ]);
              return {
                book: b,
                body,
                palette: readerPalette(chosenTheme, bookCoverPal, scheme),
              };
            }),
          ),
        ]);
      const files = await generateBookPdfs(
        items,
        activePalette,
        fontScale,
        {
          by: author => t('reader.by', { author }),
          page: p => t('chapter.page', { page: p }),
          pageOf: (page, total) => t('reader.pageOf', { page, total }),
          summary: t('book.summary'),
          untitledChapter: t('chapters.untitled'),
          contents: t('reader.contents'),
          translate: key => t(key),
          bcYear: y => t('bookEdit.year.bc', { year: y }),
        },
        format,
      );

      const shared = await shareOrDownloadPdfs(files);
      if (shared) {
        track({ name: 'export_pdf' });
        showToast(t('snackbar.export-done'));
        onClose();
      }
    } catch (error) {
      console.warn('exportPdf', error);
      showToast(t('snackbar.export-failed'));
    } finally {
      setBusy(false);
    }
  };

  const formatLabel = t(`export.formats.${format}`);

  return (
    <SidePanel
      open={open}
      switching={switching}
      depth={depth}
      index={index}
      title={t(
        scope === 'all' && shelf.length > 1
          ? 'export.titleAll'
          : 'export.title',
      )}
      action={
        <button
          type="button"
          className="round"
          disabled={busy}
          onClick={onClose}
        >
          <CloseGlyph />
          <span className="sr">{t('common.close')}</span>
        </button>
      }
      trailing={
        <button
          type="button"
          className={busy ? 'round is-commit is-busy' : 'round is-commit'}
          disabled={busy || targetBooks.length === 0}
          onClick={() => void handleExport()}
        >
          {busy ? <span className="spinner" /> : <CheckGlyph />}
          <span className="sr">{t('export.action')}</span>
        </button>
      }
      onClose={onClose}
    >
      {initialBook && shelf.length > 1 && (
        <section>
          <h3 className="section-head">{t('export.scope.label')}</h3>
          <div className="segmented reader-turn-picker">
            <button
              type="button"
              className={scope === 'book' ? 'is-active' : undefined}
              disabled={busy}
              onClick={() => setScope('book')}
            >
              {t('export.scope.book')}
            </button>
            <button
              type="button"
              className={scope === 'all' ? 'is-active' : undefined}
              disabled={busy}
              onClick={() => setScope('all')}
            >
              {t('export.scope.all')}
            </button>
          </div>
        </section>
      )}

      <section>
        <h3 className="section-head split">
          <span>{t('export.preview')}</span>
          <span className="head-value">{formatLabel}</span>
        </h3>
        <div className="export-preview-stage" aria-hidden="true">
          <div
            className={[
              'export-preview-page',
              activePalette.ornament ? 'is-book-themed' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              width: PDF_FORMATS[format].previewW,
              height: PDF_FORMATS[format].previewH,
              backgroundColor: activePalette.page,
              color: activePalette.text,
              ['--reader-accent' as string]:
                activePalette.accent ?? activePalette.muted,
            }}
          >
            <div
              key={`margin:${previewBook?.id ?? 'all'}:${chosenTheme}`}
              className={
                activePalette.ornament
                  ? 'export-preview-margin is-active'
                  : 'export-preview-margin'
              }
            >
              <BookPageEdgeMotif
                motif={previewRightMotif}
                side="right"
                color={activePalette.accent ?? activePalette.muted}
                secondaryColor={
                  activePalette.accentSecondary ?? activePalette.muted
                }
              />
            </div>
            <div className="export-preview-body">
              <BookPageOrnament
                key={`head:${previewBook?.id ?? 'all'}:${chosenTheme}`}
                style={activePalette.ornament}
                active={Boolean(activePalette.ornament)}
                variant="header"
                seed={previewHeaderOrnament}
                color={activePalette.accent ?? activePalette.muted}
                secondaryColor={
                  activePalette.accentSecondary ?? activePalette.muted
                }
              />
              <strong
                className="export-preview-heading"
                style={{
                  fontSize: `${(0.82 * fontScale).toFixed(3)}rem`,
                }}
              >
                {sampleChapterTitle}
              </strong>
              <p
                className="export-preview-quote"
                style={{
                  fontSize: `${(0.68 * fontScale).toFixed(3)}rem`,
                }}
              >
                “{sampleHighlightText}”
              </p>
              <span
                className="export-preview-ref"
                style={{ color: activePalette.muted }}
              >
                {samplePageRef}
              </span>
            </div>
            <footer
              className="export-preview-foot"
              style={{ color: activePalette.muted }}
            >
              <BookPageOrnament
                key={`foot:${previewBook?.id ?? 'all'}:${chosenTheme}`}
                style={activePalette.ornament}
                active={Boolean(activePalette.ornament)}
                variant="footer"
                seed={previewFooterOrnament}
                color={activePalette.accent ?? activePalette.muted}
                secondaryColor={
                  activePalette.accentSecondary ?? activePalette.muted
                }
              />
              <span>{t('reader.pageOf', { page: 1, total: 4 })}</span>
            </footer>
          </div>
        </div>
      </section>

      <section>
        <h3 className="section-head">{t('reader.settings.textSize')}</h3>
        <div className="card">
          <div className="cell text-scale-row">
            <button
              type="button"
              className="scale-step small"
              disabled={busy || scaleIndex <= 0}
              onClick={() => {
                if (scaleIndex <= 0) return;
                setScaleIndex(scaleIndex - 1);
              }}
            >
              A
            </button>
            <div className="scale-dots" role="group">
              {TEXT_SCALES.map((step, idx) => (
                <button
                  key={step}
                  type="button"
                  disabled={busy}
                  className={
                    idx === scaleIndex ? 'scale-dot is-active' : 'scale-dot'
                  }
                  aria-label={`${Math.round(step * 100)}%`}
                  onClick={() => {
                    if (idx === scaleIndex) return;
                    setScaleIndex(idx);
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              className="scale-step large"
              disabled={busy || scaleIndex >= TEXT_SCALES.length - 1}
              onClick={() => {
                if (scaleIndex >= TEXT_SCALES.length - 1) return;
                setScaleIndex(scaleIndex + 1);
              }}
            >
              A
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="section-head">{t('export.format')}</h3>
        <div className="segmented reader-turn-picker">
          {PDF_FORMAT_IDS.map(fmt => (
            <button
              key={fmt}
              type="button"
              disabled={busy}
              className={format === fmt ? 'is-active' : undefined}
              onClick={() => {
                if (format === fmt) return;
                setFormat(fmt);
              }}
            >
              {t(`export.formats.${fmt}`)}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="section-head">{t('reader.settings.themes')}</h3>
        <div className="theme-swatches">
          {READER_THEMES.map(themeKey => {
            const pal = readerPalette(themeKey, coverPalette, scheme);
            const active = chosenTheme === themeKey;
            return (
              <button
                key={themeKey}
                type="button"
                className={[
                  'theme-swatch',
                  themeKey === 'book' ? 'is-book-swatch' : '',
                  active ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  backgroundColor: pal.page,
                  color: pal.text,
                  ...(pal.accent
                    ? { ['--swatch-accent' as string]: pal.accent }
                    : {}),
                }}
                disabled={busy}
                onClick={() => {
                  if (chosenTheme === themeKey) return;
                  setChosenTheme(themeKey);
                }}
              >
                <span className="swatch-aa">Aa</span>
                <span className="swatch-name">
                  {t(`reader.settings.names.${themeKey}`)}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </SidePanel>
  );
}
