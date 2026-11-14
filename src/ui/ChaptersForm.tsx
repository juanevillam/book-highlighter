import { useEffect, useRef, useState } from 'react';

import {
  EMPTY_BODY,
  type Book,
  type BookBody,
  type Chapter,
  type Highlight,
} from '../books';
import { plural, t } from '../i18n';
import {
  addChapter,
  addHighlight,
  moveChapter,
  moveHighlight,
  removeChapter,
  removeHighlight,
  updateChapter,
  updateHighlight,
} from '../lib/bodyEdits';
import { parsePageRef } from '../lib/bookFields';
import { useBodiesStore } from '../store/bodies';

import { ConfirmDialog } from './ConfirmDialog';
import {
  CheckGlyph,
  CloseGlyph,
  ChevronRightGlyph,
  ContentsGlyph,
  PlusGlyph,
  SortDirectionGlyph,
  TrashGlyph,
} from './glyphs';
import { SidePanel } from './SidePanel';
import { showToast } from './Toast';

const makeId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function ChaptersPanel({
  open,
  switching = false,
  depth = 0,
  index = 0,
  book,
  onClose,
}: {
  open: boolean;
  switching?: boolean;
  depth?: number;
  index?: number;
  book: Book;
  onClose: () => void;
}) {
  const ensureBody = useBodiesStore(state => state.ensure);
  const saveBody = useBodiesStore(state => state.save);
  const entry = useBodiesStore(state => state.entries[book.id]);

  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [editingHighlight, setEditingHighlight] = useState<
    | { mode: 'new'; chapterId: string }
    | { mode: 'edit'; chapterId: string; highlight: Highlight }
    | null
  >(null);
  const [addingChapter, setAddingChapter] = useState(false);
  const [newChapterName, setNewChapterName] = useState('');
  const [confirmDeleteChapterId, setConfirmDeleteChapterId] = useState<
    string | null
  >(null);

  const addDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    void ensureBody(book.id).catch(() => {});
  }, [book.id, ensureBody]);

  useEffect(() => {
    const dialog = addDialogRef.current;
    if (!dialog) return;
    if (addingChapter && !dialog.open) {
      setNewChapterName('');
      dialog.showModal();
    }
    if (!addingChapter && dialog.open) dialog.close();
  }, [addingChapter]);

  const body: BookBody = entry?.body ?? EMPTY_BODY;
  const activeChapter: Chapter | null =
    body.chapters.find(ch => ch.id === activeChapterId) ?? null;

  const persist = async (nextBody: BookBody) => {
    try {
      await saveBody(book.id, nextBody);
    } catch (error) {
      console.warn('saveBookBody', error);
      showToast(t('snackbar.notes-save-failed'));
    }
  };

  const childStackDepth =
    (activeChapter ? 1 : 0) + (editingHighlight ? 1 : 0);

  return (
    <>
      <SidePanel
        open={open}
        switching={switching}
        depth={depth + childStackDepth}
        index={index}
        title={t('book.chapters')}
        action={
          <button type="button" className="round" onClick={onClose}>
            <CloseGlyph />
            <span className="sr">{t('common.close')}</span>
          </button>
        }
        trailing={
          <button
            type="button"
            className="round"
            title={t('chapters.add')}
            onClick={() => setAddingChapter(true)}
          >
            <PlusGlyph />
            <span className="sr">{t('chapters.add')}</span>
          </button>
        }
        onClose={onClose}
      >
        {entry?.loading && !entry.loaded ? (
          <div className="card">
            <div className="cell">
              <span className="bone line" />
            </div>
            <div className="cell">
              <span className="bone line short" />
            </div>
          </div>
        ) : body.chapters.length === 0 ? (
          <div className="side-empty is-full">
            <span className="side-empty-mark">
              <ContentsGlyph />
            </span>
            <h3>{t('chapters.empty.title')}</h3>
            <p>{t('chapters.empty.subtitle')}</p>
            <button
              type="button"
              className="pill is-primary"
              onClick={() => setAddingChapter(true)}
            >
              {t('chapters.add')}
            </button>
          </div>
        ) : (
          <div className="card">
            {body.chapters.map((chapter, idx) => (
              <div key={chapter.id} className="cell reorder-row">
                <button
                  type="button"
                  className="reorder-main"
                  onClick={() => setActiveChapterId(chapter.id)}
                >
                  <span className="reorder-title">
                    {chapter.name || t('chapters.untitled')}
                  </span>
                  <span className="reorder-sub">
                    {[
                      chapter.highlights.length > 0
                        ? plural(
                            'book.highlightCount',
                            chapter.highlights.length,
                          )
                        : '',
                      chapter.pages,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>

                <div className="reorder-controls">
                  <button
                    type="button"
                    className="round quiet"
                    disabled={idx === 0}
                    title={t('common.moveUp')}
                    onClick={() =>
                      void persist(moveChapter(body, idx, idx - 1))
                    }
                  >
                    <SortDirectionGlyph ascending />
                  </button>
                  <button
                    type="button"
                    className="round quiet"
                    disabled={idx === body.chapters.length - 1}
                    title={t('common.moveDown')}
                    onClick={() =>
                      void persist(moveChapter(body, idx, idx + 1))
                    }
                  >
                    <SortDirectionGlyph ascending={false} />
                  </button>
                  <button
                    type="button"
                    className="round quiet is-destructive"
                    title={t('chapters.delete')}
                    onClick={() => setConfirmDeleteChapterId(chapter.id)}
                  >
                    <TrashGlyph />
                  </button>
                  <span className="chevron">
                    <ChevronRightGlyph />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </SidePanel>

      {activeChapter && (
        <ChapterDetailPanel
          index={index + 1}
          depth={depth + (editingHighlight ? 1 : 0)}
          chapter={activeChapter}
          onUpdateMeta={(fields: Partial<Pick<Chapter, 'name' | 'pages'>>) =>
            void persist(updateChapter(body, activeChapter.id, fields))
          }
          onAddHighlight={() =>
            setEditingHighlight({ mode: 'new', chapterId: activeChapter.id })
          }
          onEditHighlight={hl =>
            setEditingHighlight({
              mode: 'edit',
              chapterId: activeChapter.id,
              highlight: hl,
            })
          }
          onMoveHighlight={(from, to) =>
            void persist(moveHighlight(body, activeChapter.id, from, to))
          }
          onDeleteHighlight={hlId => {
            const before = body;
            void persist(removeHighlight(body, activeChapter.id, hlId));
            showToast(t('snackbar.highlight-deleted'), {
              label: t('common.undo'),
              onAction: () => void persist(before),
            });
          }}
          onDeleteChapter={() => setConfirmDeleteChapterId(activeChapter.id)}
          onClose={() => setActiveChapterId(null)}
        />
      )}

      {editingHighlight && (
        <HighlightEditorPanel
          index={index + 2}
          initial={
            editingHighlight.mode === 'edit'
              ? editingHighlight.highlight
              : null
          }
          onSave={({ text, page }) => {
            if (editingHighlight.mode === 'new') {
              void persist(
                addHighlight(body, editingHighlight.chapterId, {
                  id: makeId(),
                  text,
                  page,
                }),
              );
            } else {
              void persist(
                updateHighlight(body, editingHighlight.chapterId, {
                  id: editingHighlight.highlight.id,
                  text,
                  page,
                }),
              );
            }
            setEditingHighlight(null);
          }}
          onDelete={
            editingHighlight.mode === 'edit'
              ? () => {
                  const before = body;
                  void persist(
                    removeHighlight(
                      body,
                      editingHighlight.chapterId,
                      editingHighlight.highlight.id,
                    ),
                  );
                  showToast(t('snackbar.highlight-deleted'), {
                    label: t('common.undo'),
                    onAction: () => void persist(before),
                  });
                  setEditingHighlight(null);
                }
              : undefined
          }
          onClose={() => setEditingHighlight(null)}
        />
      )}

      <dialog
        ref={addDialogRef}
        className="confirm"
        onClose={() => setAddingChapter(false)}
        onClick={e => e.target === e.currentTarget && setAddingChapter(false)}
      >
        <form
          method="dialog"
          onSubmit={e => {
            e.preventDefault();
            const id = makeId();
            const nextBody = addChapter(body, {
              id,
              name: newChapterName.trim() || t('chapters.untitled'),
            });
            void persist(nextBody);
            setAddingChapter(false);
            setActiveChapterId(id);
          }}
        >
          <h2>{t('chapters.add')}</h2>
          <input
            className="dialog-field"
            value={newChapterName}
            placeholder={t('chapters.newPlaceholder')}
            onChange={e => setNewChapterName(e.target.value)}
          />
          <div className="confirm-actions">
            <button
              type="button"
              className="pill"
              onClick={() => setAddingChapter(false)}
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="pill is-primary">
              {t('common.add')}
            </button>
          </div>
        </form>
      </dialog>

      <ConfirmDialog
        open={confirmDeleteChapterId !== null}
        title={t('chapters.deleteConfirm.title')}
        message={t('chapters.deleteConfirm.message')}
        cancel={t('chapters.deleteConfirm.cancel')}
        confirm={t('chapters.deleteConfirm.confirm')}
        onConfirm={() => {
          if (!confirmDeleteChapterId) return;
          if (activeChapterId === confirmDeleteChapterId) {
            setActiveChapterId(null);
          }
          void persist(removeChapter(body, confirmDeleteChapterId));
        }}
        onClose={() => setConfirmDeleteChapterId(null)}
      />
    </>
  );
}

function ChapterDetailPanel({
  index,
  depth,
  chapter,
  onUpdateMeta,
  onAddHighlight,
  onEditHighlight,
  onMoveHighlight,
  onDeleteHighlight,
  onDeleteChapter,
  onClose,
}: {
  index: number;
  depth: number;
  chapter: Chapter;
  onUpdateMeta: (fields: Partial<Pick<Chapter, 'name' | 'pages'>>) => void;
  onAddHighlight: () => void;
  onEditHighlight: (highlight: Highlight) => void;
  onMoveHighlight: (from: number, to: number) => void;
  onDeleteHighlight: (highlightId: string) => void;
  onDeleteChapter: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(chapter.name);
  const [pages, setPages] = useState(chapter.pages);

  useEffect(() => {
    setName(chapter.name);
    setPages(chapter.pages);
  }, [chapter.id, chapter.name, chapter.pages]);

  return (
    <SidePanel
      open
      depth={depth}
      index={index}
      title={chapter.name || t('chapters.untitled')}
      action={
        <button type="button" className="round" onClick={onClose}>
          <CloseGlyph />
          <span className="sr">{t('common.close')}</span>
        </button>
      }
      trailing={
        <button
          type="button"
          className="round"
          title={t('chapter.add')}
          onClick={onAddHighlight}
        >
          <PlusGlyph />
          <span className="sr">{t('chapter.add')}</span>
        </button>
      }
      onClose={onClose}
    >
      <div className="card">
        <label className="cell field">
          <input
            value={name}
            placeholder={t('chapter.name')}
            aria-label={t('chapter.name')}
            autoComplete="off"
            onChange={e => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() !== chapter.name) {
                onUpdateMeta({ name: name.trim() });
              }
            }}
          />
        </label>
        <label className="cell field">
          <input
            value={pages}
            placeholder={t('chapter.pages')}
            aria-label={t('chapter.pages')}
            autoComplete="off"
            onChange={e => setPages(e.target.value)}
            onBlur={() => {
              const tidy = pages.trim();
              setPages(tidy);
              if (tidy !== chapter.pages) {
                onUpdateMeta({ pages: tidy });
              }
            }}
          />
        </label>
      </div>

      <section>
        <h3 className="section-head split">
          <span>{t('chapter.highlights')}</span>
          <span className="head-value">{chapter.highlights.length}</span>
        </h3>

        <div className="card">
          <button
            type="button"
            className="cell new-clip-row"
            onClick={onAddHighlight}
          >
            <span>+ {t('chapter.add')}</span>
          </button>

          {chapter.highlights.length === 0 ? (
            <div className="cell muted-empty">{t('chapter.empty')}</div>
          ) : (
            chapter.highlights.map((hl, idx) => (
              <div key={hl.id} className="cell highlight-row">
                <button
                  type="button"
                  className="highlight-body-btn"
                  onClick={() => onEditHighlight(hl)}
                >
                  <span className="highlight-quote">“{hl.text}”</span>
                  {hl.page && (
                    <span className="highlight-page">
                      {t('chapter.page', { page: hl.page })}
                    </span>
                  )}
                </button>
                <div className="highlight-move">
                  <button
                    type="button"
                    className="round quiet"
                    disabled={idx === 0}
                    title={t('common.moveUp')}
                    onClick={() => onMoveHighlight(idx, idx - 1)}
                  >
                    <SortDirectionGlyph ascending />
                  </button>
                  <button
                    type="button"
                    className="round quiet"
                    disabled={idx === chapter.highlights.length - 1}
                    title={t('common.moveDown')}
                    onClick={() => onMoveHighlight(idx, idx + 1)}
                  >
                    <SortDirectionGlyph ascending={false} />
                  </button>
                  <button
                    type="button"
                    className="round quiet is-destructive"
                    title={t('common.delete')}
                    onClick={() => onDeleteHighlight(hl.id)}
                  >
                    <TrashGlyph />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="card">
        <button
          type="button"
          className="cell destructive-row"
          onClick={onDeleteChapter}
        >
          {t('chapters.delete')}
        </button>
      </div>
    </SidePanel>
  );
}

function HighlightEditorPanel({
  index,
  initial,
  onSave,
  onDelete,
  onClose,
}: {
  index: number;
  initial: Highlight | null;
  onSave: (value: { text: string; page: string | null }) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? '');
  const [page, setPage] = useState(initial?.page ?? '');

  const valid = text.trim().length > 0;

  return (
    <SidePanel
      open
      index={index}
      title={t(initial ? 'highlightEdit.title' : 'highlightEdit.titleNew')}
      action={
        <button type="button" className="round" onClick={onClose}>
          <CloseGlyph />
          <span className="sr">{t('common.cancel')}</span>
        </button>
      }
      trailing={
        <button
          type="button"
          className="round is-commit"
          disabled={!valid}
          onClick={() =>
            onSave({
              text: text.trim(),
              page: parsePageRef(page),
            })
          }
        >
          <CheckGlyph />
          <span className="sr">
            {t(initial ? 'highlightEdit.saveExisting' : 'highlightEdit.save')}
          </span>
        </button>
      }
      onClose={onClose}
    >
      <section>
        <h3 className="section-head">{t('highlightEdit.text')}</h3>
        <div className="card">
          <div className="cell textarea-cell">
            <textarea
              rows={6}
              value={text}
              placeholder={t('highlightEdit.textPlaceholder')}
              onChange={e => setText(e.target.value)}
            />
          </div>
        </div>
      </section>

      <div className="card">
        <label className="cell field">
          <input
            value={page}
            placeholder={t('highlightEdit.page')}
            aria-label={t('highlightEdit.page')}
            autoComplete="off"
            onChange={e => setPage(e.target.value)}
          />
        </label>
      </div>

      {onDelete && (
        <div className="card">
          <button
            type="button"
            className="cell destructive-row"
            onClick={onDelete}
          >
            {t('highlightEdit.delete')}
          </button>
        </div>
      )}
    </SidePanel>
  );
}
