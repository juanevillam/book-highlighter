import { useState } from 'react';

import {
  deleteBookPermanently,
  recoverBook,
  type Book,
} from '../books';
import { locale, t } from '../i18n';
import { formatRelativeTime } from '../lib/relativeTime';
import { useBodiesStore } from '../store/bodies';
import { selectTrash, useBooksStore } from '../store/books';

import { ActionSheet } from './ActionSheet';
import { Artwork } from './Artwork';
import { ConfirmDialog } from './ConfirmDialog';
import { TrashGlyph } from './glyphs';
import { showToast } from './Toast';

export function TrashSheet() {
  const books = useBooksStore(state => state.books);
  const dropBody = useBodiesStore(state => state.drop);
  const trashed = selectTrash({ books });
  const [selected, setSelected] = useState<Book | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Book | null>(null);

  if (trashed.length === 0) {
    return (
      <div className="side-empty is-full">
        <span className="side-empty-mark">
          <TrashGlyph />
        </span>
        <h3>{t('trash.empty.title')}</h3>
        <p>{t('trash.empty.subtitle')}</p>
      </div>
    );
  }

  const handleRecover = async (book: Book) => {
    try {
      await recoverBook(book.id);
      showToast(t('snackbar.book-recovered'));
    } catch (error) {
      console.warn('recoverBook', error);
      showToast(t('snackbar.book-save-failed'));
    }
  };

  const handlePermanentDelete = async (book: Book) => {
    try {
      await deleteBookPermanently(book.id);
      dropBody(book.id);
    } catch (error) {
      console.warn('deleteBookPermanently', error);
      showToast(t('snackbar.book-delete-failed'));
    }
  };

  return (
    <>
      <div className="card">
        {trashed.map(book => {
          const when = formatRelativeTime(book.trashedAt, {
            now: t('trash.meta.justNow'),
            locale,
          });
          return (
            <button
              key={book.id}
              type="button"
              className="cell link-row trash-row"
              onClick={() => setSelected(book)}
            >
              <span className="trash-thumb">
                <Artwork artUrl={book.artUrl} name={book.name} width={52} />
              </span>
              <span className="trash-copy">
                <span className="trash-title">{book.name}</span>
                <span className="trash-sub">
                  {[
                    book.author,
                    when ? `${t('trash.meta.deleted')} ${when}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <ActionSheet
        open={selected !== null}
        cancel={t('common.cancel')}
        actions={
          selected
            ? [
                {
                  label: t('trash.recover'),
                  onSelect: () => void handleRecover(selected),
                },
                {
                  label: t('trash.deletePermanently'),
                  destructive: true,
                  onSelect: () => setConfirmDelete(selected),
                },
              ]
            : []
        }
        onClose={() => setSelected(null)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('trash.deleteConfirm.title')}
        message={t('trash.deleteConfirm.message')}
        cancel={t('trash.deleteConfirm.cancel')}
        confirm={t('trash.deleteConfirm.confirm')}
        onConfirm={() => {
          if (confirmDelete) void handlePermanentDelete(confirmDelete);
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </>
  );
}
