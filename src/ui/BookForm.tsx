import { useEffect, useMemo, useRef, useState } from 'react';

import {
  createBook,
  deleteBook,
  EMPTY_BODY,
  leadPosition,
  updateBook,
  type Book,
  type BookFields,
} from '../books';
import { t } from '../i18n';
import { loadCoverPalette } from '../lib/coverPalette';
import { genreLabel, GENRES } from '../lib/genres';
import { uploadFailureKey, uploadImage, type Asset } from '../media';
import { useBodiesStore } from '../store/bodies';
import { selectShelf, useBooksStore } from '../store/books';

import { ActionSheet } from './ActionSheet';
import { ConfirmDialog, useModalDialog } from './ConfirmDialog';
import {
  CheckGlyph,
  CloseGlyph,
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
  switching = false,
  depth = 0,
  index = 0,
  book,
  onSaved,
  onDeleted,
  onClose,
}: {
  open: boolean;
  switching?: boolean;
  depth?: number;
  index?: number;
  book: Book | null;
  onSaved: (bookId: string) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const allBooks = useBooksStore(state => state.books);
  const primeBody = useBodiesStore(state => state.prime);

  const [name, setName] = useState(book?.name ?? '');
  const [author, setAuthor] = useState(book?.author ?? '');
  // Years are AD only (0 onward); an empty field means no year.
  const [yearText, setYearText] = useState(
    book?.year != null && book.year >= 0 ? String(book.year) : '',
  );
  const [genres, setGenres] = useState<string[]>(book?.genres ?? []);
  const [series, setSeries] = useState<string | null>(book?.series ?? null);
  const [seriesNumber, setSeriesNumber] = useState<number>(
    book?.seriesNumber ?? 1,
  );
  const [cover, setCover] = useState<CoverDraft>(
    book?.artUrl
      ? { state: 'unchanged', url: book.artUrl }
      : { state: 'unchanged', url: '' },
  );
  const [busy, setBusy] = useState(false);

  const [coverSheet, setCoverSheet] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [genresOpen, setGenresOpen] = useState(false);
  const [seriesDialog, setSeriesDialog] = useState(false);
  const [newSeriesInput, setNewSeriesInput] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { ref: newSeriesDialogRef, closing: closingSeriesDialog } =
    useModalDialog(seriesDialog);

  useEffect(() => {
    if (!open) return;
    setName(book?.name ?? '');
    setAuthor(book?.author ?? '');
    setYearText(
      book?.year != null && book.year >= 0 ? String(book.year) : '',
    );
    setGenres(book?.genres ?? []);
    setSeries(book?.series ?? null);
    setSeriesNumber(book?.seriesNumber ?? 1);
    setCover(
      book?.artUrl
        ? { state: 'unchanged', url: book.artUrl }
        : { state: 'unchanged', url: '' },
    );
    setGenresOpen(false);
    setConfirming(false);
    setCoverSheet(false);
    setSeriesDialog(false);
  }, [open, book]);

  useEffect(() => {
    return () => {
      if (cover.state === 'picked') {
        URL.revokeObjectURL(cover.previewUrl);
      }
    };
  }, [cover]);

  useEffect(() => {
    if (seriesDialog) setNewSeriesInput('');
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

  const canSave =
    name.trim().length > 0 && author.trim().length > 0 && !busy;

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
      const year = yearText === '' ? null : Number.parseInt(yearText, 10);
      const fields: BookFields = {
        name: name.trim(),
        author: author.trim(),
        year,
        genres,
        series: cleanSeries,
        seriesNumber: cleanSeries ? seriesNumber : null,
      };

      if (!book) {
        const initialBody = { ...EMPTY_BODY };
        const createdId = await createBook({
          fields,
          cover: uploadedCover ?? null,
          body: initialBody,
          position: leadPosition(allBooks, cleanSeries),
        });
        if (uploadedCover?.url) {
          void loadCoverPalette(uploadedCover.url, `${createdId}:${fields.name}`);
        }
        primeBody(createdId, initialBody);
        showToast(t('snackbar.book-created'));
        onSaved(createdId);
      } else {
        await updateBook({
          bookId: book.id,
          fields,
          ...(uploadedCover === undefined ? {} : { cover: uploadedCover }),
        });
        if (uploadedCover?.url) {
          void loadCoverPalette(uploadedCover.url, `${book.id}:${fields.name}`);
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

  const genresSummary =
    genres.length > 0
      ? genres.map(g => genreLabel(k => t(k), g)).join(', ')
      : t('bookEdit.genres.none');

  const childDepth = genresOpen ? 1 : 0;

  return (
    <>
      <SidePanel
        open={open}
        switching={switching}
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
            <CloseGlyph />
            <span className="sr">{t('common.close')}</span>
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
            <span className="art-box">
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
                void loadCoverPalette(
                  previewUrl,
                  book ? `${book.id}:${name || book.name}` : name,
                );
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
            <input
              value={name}
              placeholder={t('bookEdit.name.label')}
              aria-label={t('bookEdit.name.label')}
              disabled={busy}
              autoComplete="off"
              onChange={e => setName(e.target.value)}
            />
          </label>
          <label className="cell field">
            <input
              value={author}
              placeholder={t('bookEdit.author.label')}
              aria-label={t('bookEdit.author.label')}
              disabled={busy}
              autoComplete="off"
              onChange={e => setAuthor(e.target.value)}
            />
          </label>
        </div>

        <div className="card">
          <label className="cell field">
            <input
              inputMode="numeric"
              value={yearText}
              placeholder={t('bookEdit.year.label')}
              aria-label={t('bookEdit.year.label')}
              disabled={busy}
              autoComplete="off"
              onChange={e =>
                setYearText(
                  e.target.value
                    .replace(/\D/g, '')
                    .slice(0, 4)
                    .replace(/^0+(?=\d)/, ''),
                )
              }
            />
          </label>

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

        {book && (
          <div className="card">
            <button
              type="button"
              className="cell destructive-row"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              {t('bookEdit.delete')}
            </button>
          </div>
        )}

        {book && (
          <ConfirmDialog
            open={confirming}
            title={t('bookEdit.deleteConfirm.title')}
            message={t('bookEdit.deleteConfirm.message')}
            cancel={t('bookEdit.deleteConfirm.cancel')}
            confirm={t('bookEdit.deleteConfirm.confirm')}
            onConfirm={() => {
              onDeleted();
              deleteBook(book.id).then(
                () => showToast(t('snackbar.book-deleted')),
                () => showToast(t('snackbar.book-delete-failed')),
              );
            }}
            onClose={() => setConfirming(false)}
          />
        )}
      </SidePanel>

      <GenresPickerSheet
        open={open && genresOpen}
        index={index + 1}
        selected={genres}
        onChange={setGenres}
        onClose={() => setGenresOpen(false)}
      />

      <dialog
        ref={newSeriesDialogRef}
        className={closingSeriesDialog ? 'confirm is-closing' : 'confirm'}
        onCancel={e => {
          e.preventDefault();
          setSeriesDialog(false);
        }}
        onClose={() => {
          if (seriesDialog) setSeriesDialog(false);
        }}
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
  open = true,
  index,
  selected,
  onChange,
  onClose,
}: {
  open?: boolean;
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
      open={open}
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
