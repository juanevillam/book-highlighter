import { useEffect, useMemo, useRef, useState } from 'react';

import {
  createBook,
  EMPTY_BODY,
  recoverBook,
  saveBookBody,
  trashBook,
  updateBook,
  type Book,
  type BookFields,
} from '../books';
import { t } from '../i18n';
import { formatYear } from '../lib/bookFields';
import { genreLabel, GENRES } from '../lib/genres';
import { uploadFailureKey, uploadImage, type Asset } from '../media';
import { useBodiesStore } from '../store/bodies';
import { selectShelf, useBooksStore } from '../store/books';

import { ActionSheet } from './ActionSheet';
import {
  CheckGlyph,
  ChevronLeftGlyph,
  ChevronRightGlyph,
  PlusGlyph,
  SearchGlyph,
} from './glyphs';
import { SidePanel } from './SidePanel';
import { showToast } from './Toast';

type CoverDraft =
  | { state: 'unchanged'; url: string }
  | { state: 'picked'; file: File; previewUrl: string }
  | { state: 'removed' };

export function BookFormPanel({
  open,
  depth = 0,
  index = 0,
  book,
  onSaved,
  onDeleted,
  onClose,
}: {
  open: boolean;
  depth?: number;
  index?: number;
  book: Book | null;
  onSaved: (bookId: string) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const allBooks = useBooksStore(state => state.books);
  const ensureBody = useBodiesStore(state => state.ensure);
  const primeBody = useBodiesStore(state => state.prime);
  const bodyEntry = useBodiesStore(state =>
    book ? state.entries[book.id] : undefined,
  );

  const [name, setName] = useState(book?.name ?? '');
  const [author, setAuthor] = useState(book?.author ?? '');
  const [year, setYear] = useState<number | null>(book?.year ?? null);
  const [genres, setGenres] = useState<string[]>(book?.genres ?? []);
  const [series, setSeries] = useState<string | null>(book?.series ?? null);
  const [seriesNumber, setSeriesNumber] = useState<number>(
    book?.seriesNumber ?? 1,
  );
  const [summary, setSummary] = useState('');
  const [summaryLoaded, setSummaryLoaded] = useState(!book);
  const [cover, setCover] = useState<CoverDraft>(
    book?.artUrl
      ? { state: 'unchanged', url: book.artUrl }
      : { state: 'unchanged', url: '' },
  );
  const [busy, setBusy] = useState(false);

  const [coverSheet, setCoverSheet] = useState(false);
  const [genresOpen, setGenresOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  const [seriesDialog, setSeriesDialog] = useState(false);
  const [newSeriesInput, setNewSeriesInput] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const newSeriesDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!book) {
      setSummary('');
      setSummaryLoaded(true);
      return;
    }
    setSummaryLoaded(false);
    ensureBody(book.id)
      .then(loaded => {
        setSummary(loaded.summary);
        setSummaryLoaded(true);
      })
      .catch(() => {
        setSummaryLoaded(true);
      });
  }, [book, ensureBody]);

  useEffect(() => {
    return () => {
      if (cover.state === 'picked') {
        URL.revokeObjectURL(cover.previewUrl);
      }
    };
  }, [cover]);

  useEffect(() => {
    const dialog = newSeriesDialogRef.current;
    if (!dialog) return;
    if (seriesDialog && !dialog.open) {
      setNewSeriesInput('');
      dialog.showModal();
    }
    if (!seriesDialog && dialog.open) dialog.close();
  }, [seriesDialog]);

  const existingSeriesNames = useMemo(() => {
    const set = new Set<string>();
    for (const entry of selectShelf({ books: allBooks })) {
      if (entry.series) set.add(entry.series);
    }
    if (series) set.add(series);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allBooks, series]);

  const coverPreview =
    cover.state === 'picked'
      ? cover.previewUrl
      : cover.state === 'unchanged'
        ? cover.url
        : '';

  const canSave = name.trim().length > 0 && !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      let uploadedCover: Asset | null | undefined;
      if (cover.state === 'picked') {
        uploadedCover = await uploadImage(cover.file, 'covers');
      } else if (cover.state === 'removed') {
        uploadedCover = null;
      }

      const cleanSeries = series?.trim() || null;
      const fields: BookFields = {
        name: name.trim(),
        author: author.trim(),
        year,
        genres,
        series: cleanSeries,
        seriesNumber: cleanSeries ? seriesNumber : null,
      };

      if (!book) {
        const initialBody = {
          ...EMPTY_BODY,
          summary: summary.trim(),
        };
        const createdId = await createBook({
          fields,
          cover: uploadedCover ?? null,
          body: initialBody,
        });
        primeBody(createdId, initialBody);
        showToast(t('snackbar.book-created'));
        onSaved(createdId);
      } else {
        await updateBook({
          bookId: book.id,
          fields,
          ...(uploadedCover === undefined ? {} : { cover: uploadedCover }),
        });
        const currentBody = bodyEntry?.body ?? (await ensureBody(book.id));
        if (summaryLoaded && summary.trim() !== currentBody.summary.trim()) {
          const updatedBody = { ...currentBody, summary: summary.trim() };
          await saveBookBody(book.id, updatedBody);
          primeBody(book.id, updatedBody);
        }
        showToast(t('snackbar.book-updated'));
        onSaved(book.id);
      }
    } catch (error) {
      console.warn('BookForm save', error);
      showToast(t(uploadFailureKey(error, 'snackbar.book-save-failed')));
    } finally {
      setBusy(false);
    }
  };

  const handleTrash = async () => {
    if (!book || busy) return;
    setBusy(true);
    try {
      const deletedId = book.id;
      await trashBook(deletedId);
      onDeleted();
      showToast(t('snackbar.book-deleted'), {
        label: t('common.undo'),
        onAction: () => {
          void recoverBook(deletedId).then(
            () => showToast(t('snackbar.book-recovered')),
            () => showToast(t('snackbar.book-save-failed')),
          );
        },
      });
    } catch (error) {
      console.warn('trashBook', error);
      showToast(t('snackbar.book-delete-failed'));
      setBusy(false);
    }
  };

  const genresSummary =
    genres.length > 0
      ? genres.map(g => genreLabel(k => t(k), g)).join(', ')
      : t('bookEdit.genres.none');

  const yearSummary =
    year !== null
      ? formatYear(year, y => t('bookEdit.year.bc', { year: y }))
      : t('bookEdit.year.none');

  const childDepth = genresOpen || yearOpen ? 1 : 0;

  return (
    <>
      <SidePanel
        open={open}
        depth={depth + childDepth}
        index={index}
        title={t(book ? 'app.bookEdit' : 'app.bookNew')}
        action={
          <button
            type="button"
            className="round"
            disabled={busy}
            onClick={onClose}
          >
            <ChevronLeftGlyph />
            <span className="sr">{t('common.cancel')}</span>
          </button>
        }
        trailing={
          <button
            type="button"
            className={
              busy ? 'round is-commit is-busy' : 'round is-commit'
            }
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            {busy ? <span className="spinner" /> : <CheckGlyph />}
            <span className="sr">
              {t(book ? 'bookEdit.saveExisting' : 'bookEdit.save')}
            </span>
          </button>
        }
        onClose={onClose}
      >
        <div className="art-slot">
          <button
            type="button"
            className="art-pick"
            disabled={busy}
            onClick={() =>
              coverPreview
                ? setCoverSheet(true)
                : fileInputRef.current?.click()
            }
          >
            <span className="art-box is-book">
              {coverPreview ? (
                <img src={coverPreview} alt="" />
              ) : (
                <PlusGlyph />
              )}
            </span>
            <span className="text-action">
              {t(
                coverPreview ? 'bookEdit.cover.change' : 'bookEdit.cover.add',
              )}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) {
                const previewUrl = URL.createObjectURL(file);
                setCover(prev => {
                  if (prev.state === 'picked') {
                    URL.revokeObjectURL(prev.previewUrl);
                  }
                  return { state: 'picked', file, previewUrl };
                });
              }
              e.target.value = '';
            }}
          />
          <ActionSheet
            open={coverSheet}
            cancel={t('common.cancel')}
            actions={[
              {
                label: t('bookEdit.cover.change'),
                onSelect: () => fileInputRef.current?.click(),
              },
              {
                label: t('bookEdit.cover.remove'),
                destructive: true,
                onSelect: () => setCover({ state: 'removed' }),
              },
            ]}
            onClose={() => setCoverSheet(false)}
          />
        </div>

        <div className="card">
          <label className="cell field">
            <span className="field-caption">{t('bookEdit.name.label')}</span>
            <input
              value={name}
              placeholder={t('bookEdit.name.placeholder')}
              disabled={busy}
              onChange={e => setName(e.target.value)}
            />
          </label>
          <label className="cell field">
            <span className="field-caption">{t('bookEdit.author.label')}</span>
            <input
              value={author}
              placeholder={t('bookEdit.author.placeholder')}
              disabled={busy}
              onChange={e => setAuthor(e.target.value)}
            />
          </label>
        </div>

        <div className="card">
          <button
            type="button"
            className="cell link-row"
            disabled={busy}
            onClick={() => setYearOpen(true)}
          >
            <span className="cell-name">{t('bookEdit.year.label')}</span>
            <span className="cell-value">{yearSummary}</span>
            <span className="chevron">
              <ChevronRightGlyph />
            </span>
          </button>

          <button
            type="button"
            className="cell link-row"
            disabled={busy}
            onClick={() => setGenresOpen(true)}
          >
            <span className="cell-name">{t('bookEdit.genres.label')}</span>
            <span className="cell-value">{genresSummary}</span>
            <span className="chevron">
              <ChevronRightGlyph />
            </span>
          </button>

          <label className="cell picker">
            <span className="cell-name">{t('bookEdit.series.label')}</span>
            <select
              value={series ?? '__none__'}
              disabled={busy}
              onChange={e => {
                const val = e.target.value;
                if (val === '__none__') {
                  setSeries(null);
                } else if (val === '__new__') {
                  setSeriesDialog(true);
                } else {
                  setSeries(val);
                }
              }}
            >
              <option value="__none__">{t('bookEdit.series.none')}</option>
              {existingSeriesNames.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="__new__">{t('bookEdit.series.new')}</option>
            </select>
          </label>

          {series && (
            <div className="cell">
              <span className="cell-name">
                {t('bookEdit.series.number', { number: seriesNumber })}
              </span>
              <div className="stepper">
                <button
                  type="button"
                  disabled={busy || seriesNumber <= 1}
                  onClick={() => setSeriesNumber(n => Math.max(1, n - 1))}
                >
                  −
                </button>
                <button
                  type="button"
                  disabled={busy || seriesNumber >= 99}
                  onClick={() => setSeriesNumber(n => Math.min(99, n + 1))}
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>

        <section>
          <h3 className="section-head">{t('bookEdit.summary.label')}</h3>
          <div className="card">
            <div className="cell textarea-cell">
              <textarea
                rows={5}
                value={summary}
                placeholder={t('bookEdit.summary.placeholder')}
                disabled={busy || !summaryLoaded}
                onChange={e => setSummary(e.target.value)}
              />
            </div>
          </div>
        </section>

        {book && (
          <div className="card">
            <button
              type="button"
              className="cell destructive-row"
              disabled={busy}
              onClick={() => void handleTrash()}
            >
              {t('bookEdit.delete')}
            </button>
          </div>
        )}
      </SidePanel>

      {genresOpen && (
        <GenresPickerSheet
          index={index + 1}
          selected={genres}
          onChange={setGenres}
          onClose={() => setGenresOpen(false)}
        />
      )}

      {yearOpen && (
        <YearPickerSheet
          index={index + 1}
          value={year}
          onChange={setYear}
          onClose={() => setYearOpen(false)}
        />
      )}

      <dialog
        ref={newSeriesDialogRef}
        className="confirm"
        onClose={() => setSeriesDialog(false)}
        onClick={e => e.target === e.currentTarget && setSeriesDialog(false)}
      >
        <form
          method="dialog"
          onSubmit={e => {
            e.preventDefault();
            const trimmed = newSeriesInput.trim();
            if (trimmed) setSeries(trimmed);
            setSeriesDialog(false);
          }}
        >
          <h2>{t('bookEdit.series.newTitle')}</h2>
          <input
            className="dialog-field"
            value={newSeriesInput}
            placeholder={t('bookEdit.series.newPlaceholder')}
            onChange={e => setNewSeriesInput(e.target.value)}
          />
          <div className="confirm-actions">
            <button
              type="button"
              className="pill"
              onClick={() => setSeriesDialog(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="pill is-primary"
              disabled={!newSeriesInput.trim()}
            >
              {t('common.done')}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function GenresPickerSheet({
  index,
  selected,
  onChange,
  onClose,
}: {
  index: number;
  selected: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
}) {
  const [queryText, setQueryText] = useState('');

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!q) return [...GENRES];
    return GENRES.filter(key => {
      const label = genreLabel(k => t(k), key).toLowerCase();
      return label.includes(q) || key.includes(q);
    });
  }, [queryText]);

  const toggle = (key: string) => {
    if (selected.includes(key)) {
      onChange(selected.filter(g => g !== key));
    } else {
      onChange([...selected, key]);
    }
  };

  return (
    <SidePanel
      open
      index={index}
      title={t('bookEdit.genres.label')}
      onClose={onClose}
    >
      <div className="search-box">
        <SearchGlyph />
        <input
          value={queryText}
          placeholder={t('bookEdit.genres.search')}
          onChange={e => setQueryText(e.target.value)}
        />
      </div>

      <div className="card">
        {filtered.map(key => {
          const active = selected.includes(key);
          return (
            <button
              key={key}
              type="button"
              className="cell link-row"
              onClick={() => toggle(key)}
            >
              <span className="cell-name">{genreLabel(k => t(k), key)}</span>
              {active && (
                <span className="check-mark">
                  <CheckGlyph />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </SidePanel>
  );
}

export function YearPickerSheet({
  index,
  value,
  onChange,
  onClose,
}: {
  index: number;
  value: number | null;
  onChange: (next: number | null) => void;
  onClose: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const [hasYear, setHasYear] = useState(value !== null);
  const [era, setEra] = useState<'ad' | 'bc'>(
    value !== null && value < 0 ? 'bc' : 'ad',
  );
  const [digits, setDigits] = useState(
    value !== null ? String(Math.abs(value)) : String(currentYear),
  );

  const apply = (nextHas: boolean, nextEra: 'ad' | 'bc', nextDigits: string) => {
    if (!nextHas) {
      onChange(null);
      return;
    }
    const parsed = Number.parseInt(nextDigits.replace(/\D/g, ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      onChange(null);
      return;
    }
    const clamped = Math.min(9999, parsed);
    onChange(nextEra === 'bc' ? -clamped : clamped);
  };

  const quickYears = [
    currentYear,
    currentYear - 1,
    2020,
    2010,
    2000,
    1950,
    1900,
    -44,
    -380,
  ];

  return (
    <SidePanel
      open
      index={index}
      title={t('bookEdit.year.label')}
      onClose={onClose}
    >
      <div className="card">
        <label className="cell">
          <span className="cell-name">{t('bookEdit.year.label')}</span>
          <input
            type="checkbox"
            className="switch"
            checked={hasYear}
            onChange={e => {
              const checked = e.target.checked;
              setHasYear(checked);
              apply(checked, era, digits);
            }}
          />
        </label>

        {hasYear && (
          <>
            <div className="cell">
              <div className="segmented">
                <button
                  type="button"
                  className={era === 'ad' ? 'is-active' : undefined}
                  onClick={() => {
                    setEra('ad');
                    apply(true, 'ad', digits);
                  }}
                >
                  {t('bookEdit.year.eraAd')}
                </button>
                <button
                  type="button"
                  className={era === 'bc' ? 'is-active' : undefined}
                  onClick={() => {
                    setEra('bc');
                    apply(true, 'bc', digits);
                  }}
                >
                  {t('bookEdit.year.eraBc')}
                </button>
              </div>
            </div>

            <label className="cell field">
              <span className="field-caption">{t('bookEdit.year.label')}</span>
              <input
                inputMode="numeric"
                value={digits}
                placeholder={t('bookEdit.year.placeholder')}
                onChange={e => {
                  const clean = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setDigits(clean);
                  apply(true, era, clean);
                }}
              />
            </label>
          </>
        )}
      </div>

      {hasYear && (
        <div className="year-chips">
          {quickYears.map(y => {
            const label = formatYear(y, abs =>
              t('bookEdit.year.bc', { year: abs }),
            );
            const active = value === y;
            return (
              <button
                key={y}
                type="button"
                className={active ? 'pill is-primary' : 'pill'}
                onClick={() => {
                  setHasYear(true);
                  setEra(y < 0 ? 'bc' : 'ad');
                  setDigits(String(Math.abs(y)));
                  onChange(y);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </SidePanel>
  );
}
