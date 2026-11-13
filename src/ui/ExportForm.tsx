import { useState } from 'react';

import { track } from '../analytics';
import { useScheme } from '../appearance';
import { type Book } from '../books';
import { t } from '../i18n';
import { sortLibrary } from '../lib/librarySort';
import {
  effectiveTheme,
  READER_THEMES,
  readerPalette,
  TEXT_SCALES,
  type ReaderTheme,
} from '../lib/readerThemes';
import { useBodiesStore } from '../store/bodies';
import { selectShelf, useBooksStore } from '../store/books';
import { useLibrarySortStore } from '../store/librarySort';
import { useReaderSettingsStore } from '../store/readerSettings';

import { CheckGlyph, CloseGlyph } from './glyphs';
import { SidePanel } from './SidePanel';
import { showToast } from './Toast';

export function ExportPanel({
  open,
  depth = 0,
  index = 0,
  initialBook,
  onClose,
}: {
  open: boolean;
  depth?: number;
  index?: number;
  /** When null, opened from Account -> "Export All Books". */
  initialBook: Book | null;
  onClose: () => void;
}) {
  const scheme = useScheme();
  const books = useBooksStore(state => state.books);
  const sort = useLibrarySortStore(state => state.sort);
  const ensureBody = useBodiesStore(state => state.ensure);

  const savedReaderTheme = useReaderSettingsStore(state => state.theme);
  const savedScaleIndex = useReaderSettingsStore(state => state.scaleIndex);

  const [scope, setScope] = useState<'book' | 'all'>(
    initialBook ? 'book' : 'all',
  );
  const [chosenTheme, setChosenTheme] = useState<ReaderTheme>(
    effectiveTheme(savedReaderTheme, scheme),
  );
  const [scaleIndex, setScaleIndex] = useState<number>(savedScaleIndex);
  const [busy, setBusy] = useState(false);

  const shelf = sortLibrary(selectShelf({ books }), sort);
  const targetBooks =
    scope === 'book' && initialBook ? [initialBook] : shelf;

  const handleExport = async () => {
    if (busy || targetBooks.length === 0) return;
    setBusy(true);
    try {
      const [{ generateBookPdfs, shareOrDownloadPdfs }, items] =
        await Promise.all([
          import('../lib/pdfExport'),
          Promise.all(
            targetBooks.map(async b => ({
              book: b,
              body: await ensureBody(b.id),
            })),
          ),
        ]);
      const palette = readerPalette(chosenTheme);
      const fontScale = TEXT_SCALES[scaleIndex] ?? 1;
      const files = await generateBookPdfs(items, palette, fontScale, {
        by: author => t('reader.by', { author }),
        page: p => t('chapter.page', { page: p }),
        pageOf: (page, total) => t('reader.pageOf', { page, total }),
        summary: t('book.summary'),
        untitledChapter: t('chapters.untitled'),
        translate: key => t(key),
        bcYear: y => t('bookEdit.year.bc', { year: y }),
      });

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

  return (
    <SidePanel
      open={open}
      depth={depth}
      index={index}
      title={t(initialBook ? 'export.title' : 'export.titleAll')}
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
        <div className="card">
          <div className="cell">
            <div className="segmented">
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
          </div>
        </div>
      )}

      <section>
        <h3 className="section-head split">
          <span>{t('reader.settings.textSize')}</span>
          <span className="head-value">
            {Math.round((TEXT_SCALES[scaleIndex] ?? 1) * 100)}%
          </span>
        </h3>
        <div className="card">
          <div className="cell scale-row">
            <span className="scale-a small">A</span>
            <input
              type="range"
              className="slider"
              min={0}
              max={TEXT_SCALES.length - 1}
              step={1}
              value={scaleIndex}
              disabled={busy}
              style={
                {
                  '--fill': scaleIndex / Math.max(1, TEXT_SCALES.length - 1),
                } as React.CSSProperties
              }
              onChange={e => setScaleIndex(Number(e.target.value))}
            />
            <span className="scale-a large">A</span>
          </div>
        </div>
      </section>

      <section>
        <h3 className="section-head">{t('reader.settings.themes')}</h3>
        <div className="theme-swatches">
          {READER_THEMES.map(themeKey => {
            const pal = readerPalette(themeKey);
            const active = chosenTheme === themeKey;
            return (
              <button
                key={themeKey}
                type="button"
                className={active ? 'theme-swatch is-active' : 'theme-swatch'}
                style={{
                  background: pal.page,
                  color: pal.text,
                }}
                disabled={busy}
                onClick={() => setChosenTheme(themeKey)}
              >
                <span className="swatch-aa">Aa</span>
                <span className="swatch-label">
                  {t(`reader.settings.names.${themeKey}`)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="section-foot">
          {t(scope === 'all' ? 'export.footerAll' : 'export.footer')}
        </p>
      </section>
    </SidePanel>
  );
}
