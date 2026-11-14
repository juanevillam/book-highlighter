import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { type User } from 'firebase/auth';

import { type Book } from '../books';
import { t } from '../i18n';
import { sortLibrary } from '../lib/librarySort';
import { shelfEntries } from '../lib/shelf';
import { useBodiesStore } from '../store/bodies';
import {
  selectShelf,
  useBooksStore,
  useBooksSubscription,
} from '../store/books';
import { useLibrarySortStore } from '../store/librarySort';
import { useTrophySystem } from '../trophies';
import { AccountForm } from '../ui/AccountForm';
import { Backdrop, PlayerBackdrop } from '../ui/Backdrop';
import { BookFormPanel } from '../ui/BookForm';
import { BookStage } from '../ui/BookStage';
import { ChaptersPanel } from '../ui/ChaptersForm';
import { ExportPanel } from '../ui/ExportForm';
import { FilterGlyph, GearGlyph } from '../ui/glyphs';
import { LibraryGrid, SortForm } from '../ui/LibraryGrid';
import { Reader } from '../ui/Reader';
import { SeriesSheet } from '../ui/SeriesSheet';
import { SettingsForm } from '../ui/SettingsForm';
import { SidePanel } from '../ui/SidePanel';
import { Toast } from '../ui/Toast';
import { TrophiesForm, TrophyBanner } from '../ui/Trophies';

const DESK = '(min-width: 64rem)';
const LEAVE_MS = 320;
const APP_NAME = 'Book Highlighter';

const morph = (change: () => void) => {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };

  if (
    !doc.startViewTransition ||
    !matchMedia(DESK).matches ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    change();
    return;
  }

  doc.startViewTransition(() => flushSync(change));
};

const useLargeTitle = () => {
  const title = useRef<HTMLHeadingElement>(null);
  const [titled, setTitled] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setTitled(!entry.isIntersecting),
      { rootMargin: '-56px 0px 0px 0px' },
    );

    if (title.current) observer.observe(title.current);
    return () => observer.disconnect();
  }, []);

  return { title, titled };
};

type ToolEntry =
  | { kind: 'chapters'; bookId: string }
  | { kind: 'export'; book: Book };

type ModalEntry =
  | { kind: 'settings' | 'account' | 'trophies' | 'sort' }
  | { kind: 'series'; name: string }
  | { kind: 'bookForm'; book: Book | null }
  | { kind: 'export'; book: null };

type Entry = ToolEntry | ModalEntry;

type Layer<T extends Entry> = {
  id: number;
  entry: T;
  leaving: boolean;
  slot?: number;
  switching?: boolean;
};

let nextLayerId = 0;

export function Home({ user }: { user: User }) {
  useBooksSubscription(user.uid);
  useTrophySystem(user.uid);

  const books = useBooksStore(state => state.books);
  const hasSettled = useBooksStore(state => state.hasSettled);
  const error = useBooksStore(state => state.error);
  const sort = useLibrarySortStore(state => state.sort);

  const shelf = useMemo(
    () => sortLibrary(selectShelf({ books }), sort),
    [books, sort],
  );
  const entries = useMemo(() => shelfEntries(shelf), [shelf]);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [mobileStageOpen, setMobileStageOpen] = useState(false);
  const [readingBookId, setReadingBookId] = useState<string | null>(null);
  const [toolLayers, setToolLayers] = useState<Layer<ToolEntry>[]>([]);
  const [modalLayers, setModalLayers] = useState<Layer<ModalEntry>[]>([]);
  const [, setProfileTick] = useState(0);

  const { title, titled } = useLargeTitle();

  // Clear cached bodies on sign-out / unmount.
  useEffect(() => () => useBodiesStore.getState().reset(), []);

  // Keep `selectedBook` synchronized with live shelf; prime first book on desktop.
  const selectedBook = useMemo(
    () => shelf.find(b => b.id === selectedBookId) ?? null,
    [shelf, selectedBookId],
  );

  useEffect(() => {
    if (!hasSettled) return;
    if (selectedBookId && !shelf.some(b => b.id === selectedBookId)) {
      setSelectedBookId(shelf[0]?.id ?? null);
      setMobileStageOpen(false);
      return;
    }
    if (!selectedBookId && shelf.length > 0 && matchMedia(DESK).matches) {
      setSelectedBookId(shelf[0].id);
    }
  }, [hasSettled, selectedBookId, shelf]);

  const readingBook = useMemo(
    () => shelf.find(b => b.id === readingBookId) ?? null,
    [shelf, readingBookId],
  );

  const liveTools = toolLayers.filter(layer => !layer.leaving);
  const toolBase = liveTools[0]?.entry.kind ?? null;
  const liveModals = modalLayers.filter(layer => !layer.leaving);
  const modalBase = liveModals[0]?.entry.kind ?? null;

  const [stood, setStood] = useState(false);
  const hasCurrent = Boolean(selectedBook);

  useEffect(() => {
    if (hasCurrent === stood) return;
    morph(() => setStood(hasCurrent));
  }, [hasCurrent, stood]);

  const tooled = liveTools.length > 0 && hasCurrent;
  const [toolsShown, setToolsShown] = useState(false);
  useEffect(() => {
    if (tooled !== toolsShown) morph(() => setToolsShown(tooled));
  }, [tooled, toolsShown]);

  const leaveIn = <T extends Entry>(
    setStack: React.Dispatch<React.SetStateAction<Layer<T>[]>>,
    keep: (layer: Layer<T>, index: number) => boolean,
  ) => {
    setStack(all => {
      const liveBefore = all.filter(l => !l.leaving);
      return all.map((layer, i) =>
        layer.leaving || keep(layer, i)
          ? layer
          : {
              ...layer,
              leaving: true,
              slot: liveBefore.indexOf(layer),
            },
      );
    });
    window.setTimeout(
      () => setStack(all => all.filter(layer => !layer.leaving)),
      LEAVE_MS,
    );
  };

  const pushTool = (entry: ToolEntry, switching = false) =>
    setToolLayers(all => [
      ...all,
      { id: (nextLayerId += 1), entry, leaving: false, switching },
    ]);

  const popTool = () => {
    const front = liveTools[liveTools.length - 1];
    if (front) leaveIn(setToolLayers, layer => layer.id !== front.id);
  };

  const closeTools = () => leaveIn(setToolLayers, () => false);

  const openTool = (entry: ToolEntry) => {
    if (liveTools.length === 1 && toolBase === entry.kind) {
      closeTools();
      return;
    }
    const wasOpen = liveTools.length > 0;
    if (wasOpen) closeTools();
    pushTool(entry, wasOpen);
  };

  const pushModal = (entry: ModalEntry) =>
    setModalLayers(all => [
      ...all,
      { id: (nextLayerId += 1), entry, leaving: false },
    ]);

  const popModal = () => {
    const front = liveModals[liveModals.length - 1];
    if (front) leaveIn(setModalLayers, layer => layer.id !== front.id);
  };

  const closeModals = () => leaveIn(setModalLayers, () => false);

  const openModal = (entry: ModalEntry) => {
    if (
      liveModals.length === 1 &&
      modalBase === entry.kind &&
      !(entry.kind === 'bookForm' && entry.book === null) &&
      entry.kind !== 'series'
    ) {
      const prev = liveModals[0].entry;
      const sameTarget =
        entry.kind !== 'bookForm' ||
        prev.kind !== 'bookForm' ||
        entry.book?.id === prev.book?.id;
      if (sameTarget) {
        closeModals();
        return;
      }
    }
    closeModals();
    pushModal(entry);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        readingBook ||
        e.key !== 'Escape' ||
        document.querySelector(
          'dialog[open], .progress-overlay, .sub-sheet.is-open',
        )
      ) {
        return;
      }
      if (liveModals.length) popModal();
      else if (liveTools.length) popTool();
      else setMobileStageOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const className = [
    'home',
    selectedBook ? 'has-current' : '',
    stood ? 'is-staged' : '',
    mobileStageOpen ? 'is-expanded' : '',
    toolsShown ? 'is-tooled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const renderLayer = <T extends Entry>(
    layer: Layer<T>,
    indexInGroup: number,
    depth: number,
    onPop: () => void,
    onCloseGroup: () => void,
  ) => {
    const isOpen = !layer.leaving;
    const effectiveDepth = layer.leaving ? 0 : depth;
    const handleClose = layer.leaving ? () => {} : onPop;
    const switching = Boolean(layer.switching);
    const { entry } = layer;

    switch (entry.kind) {
      case 'bookForm':
        return (
          <BookFormPanel
            key={layer.id}
            open={isOpen}
            switching={switching}
            depth={effectiveDepth}
            index={indexInGroup}
            book={entry.book}
            onSaved={bookId => {
              setSelectedBookId(bookId);
              setMobileStageOpen(true);
              onCloseGroup();
            }}
            onDeleted={() => {
              onCloseGroup();
              setMobileStageOpen(false);
            }}
            onClose={handleClose}
          />
        );

      case 'chapters': {
        const book = shelf.find(b => b.id === entry.bookId) ?? selectedBook;
        if (!book) return null;
        return (
          <ChaptersPanel
            key={layer.id}
            open={isOpen}
            switching={switching}
            depth={effectiveDepth}
            index={indexInGroup}
            book={book}
            onClose={handleClose}
          />
        );
      }

      case 'export':
        return (
          <ExportPanel
            key={layer.id}
            open={isOpen}
            switching={switching}
            depth={effectiveDepth}
            index={indexInGroup}
            initialBook={entry.book}
            onClose={handleClose}
          />
        );

      case 'settings':
        return (
          <SidePanel
            key={layer.id}
            open={isOpen}
            switching={switching}
            depth={effectiveDepth}
            index={indexInGroup}
            title={t('app.settings')}
            onClose={handleClose}
          >
            <SettingsForm
              user={user}
              onAccount={() => pushModal({ kind: 'account' })}
            />
          </SidePanel>
        );

      case 'account':
        return (
          <SidePanel
            key={layer.id}
            open={isOpen}
            switching={switching}
            depth={effectiveDepth}
            index={indexInGroup}
            title={t('settings.account.sheetTitle')}
            onClose={handleClose}
          >
            <AccountForm
              user={user}
              onChanged={() => setProfileTick(n => n + 1)}
              onTrophies={() => pushModal({ kind: 'trophies' })}
              onExportAll={() => pushModal({ kind: 'export', book: null })}
            />
          </SidePanel>
        );

      case 'trophies':
        return (
          <SidePanel
            key={layer.id}
            open={isOpen}
            switching={switching}
            depth={effectiveDepth}
            index={indexInGroup}
            title={t('trophies.title')}
            onClose={handleClose}
          >
            <TrophiesForm />
          </SidePanel>
        );

      case 'sort':
        return (
          <SidePanel
            key={layer.id}
            open={isOpen}
            switching={switching}
            depth={effectiveDepth}
            index={indexInGroup}
            title={t('home.sort.label')}
            onClose={handleClose}
          >
            <SortForm />
          </SidePanel>
        );

      case 'series': {
        const seriesBooks = shelf.filter(b => b.series === entry.name);
        return (
          <SidePanel
            key={layer.id}
            open={isOpen}
            switching={switching}
            depth={effectiveDepth}
            index={indexInGroup}
            title={entry.name}
            onClose={handleClose}
          >
            <SeriesSheet
              books={seriesBooks}
              selectedBookId={selectedBook?.id ?? null}
              onSelectBook={book => {
                setSelectedBookId(book.id);
                setMobileStageOpen(true);
                onCloseGroup();
              }}
            />
          </SidePanel>
        );
      }
    }
  };

  const renderStack = <T extends Entry>(
    group: Layer<T>[],
    onPop: () => void,
    onCloseGroup: () => void,
  ) => {
    const front = group.filter(layer => !layer.leaving);
    return group.map((layer, idx) => {
      const liveIndex = front.indexOf(layer);
      const depth = front.length - 1 - liveIndex;
      const index = liveIndex >= 0 ? liveIndex : (layer.slot ?? idx);
      return renderLayer(layer, index, depth, onPop, onCloseGroup);
    });
  };

  const editingCurrent =
    liveModals.length === 1 &&
    liveModals[0].entry.kind === 'bookForm' &&
    liveModals[0].entry.book !== null &&
    liveModals[0].entry.book.id === selectedBook?.id;

  return (
    <div className={className}>
      <Backdrop artUrl={selectedBook?.artUrl ?? ''} />

      <main className="library">
        <header className={titled ? 'bar is-edge is-titled' : 'bar'}>
          <span className="bar-lead" aria-hidden="true" />

          <span className="bar-title" aria-hidden={!titled}>
            {APP_NAME}
          </span>

          <div className="bar-actions">
            <button
              type="button"
              className="round"
              disabled={!hasSettled || Boolean(error)}
              aria-expanded={modalBase === 'sort'}
              aria-label={`${t('home.sort.label')}: ${t(`home.sort.keys.${sort.key}`)}`}
              onClick={() => openModal({ kind: 'sort' })}
            >
              <FilterGlyph />
              <span className="sr">{t('home.sort.label')}</span>
            </button>
            <button
              type="button"
              className="round"
              aria-expanded={modalBase === 'settings'}
              onClick={() => openModal({ kind: 'settings' })}
            >
              <GearGlyph />
              <span className="sr">{t('app.settings')}</span>
            </button>
          </div>
        </header>

        <h1 ref={title} className="large-title">
          {APP_NAME}
        </h1>

        <LibraryGrid
          entries={entries}
          hasSettled={hasSettled}
          error={error}
          selectedBookId={selectedBook?.id ?? null}
          onSelectBook={book => {
            setSelectedBookId(book.id);
            setMobileStageOpen(true);
          }}
          onSelectSeries={name => openModal({ kind: 'series', name })}
          onNewBook={() => openModal({ kind: 'bookForm', book: null })}
        />
      </main>

      <div className="stage">
        <div className="now-column">
          <PlayerBackdrop artUrl={selectedBook?.artUrl ?? ''} />
          {selectedBook && (
            <BookStage
              book={selectedBook}
              panel={
                editingCurrent
                  ? 'bookForm'
                  : toolBase === 'chapters' || toolBase === 'export'
                    ? toolBase
                    : null
              }
              onCloseMobile={() => setMobileStageOpen(false)}
              onRead={() => setReadingBookId(selectedBook.id)}
              onOpenChapters={() =>
                openTool({ kind: 'chapters', bookId: selectedBook.id })
              }
              onEditBook={() =>
                openModal({ kind: 'bookForm', book: selectedBook })
              }
              onExportBook={() =>
                openTool({ kind: 'export', book: selectedBook })
              }
            />
          )}
        </div>
      </div>

      <div className="tools">
        {renderStack(toolLayers, popTool, closeTools)}
      </div>

      <div className="modals">
        <div
          className={
            liveModals.length ? 'modal-scrim is-open' : 'modal-scrim'
          }
          aria-hidden="true"
          onClick={closeModals}
        />
        {renderStack(modalLayers, popModal, closeModals)}
      </div>

      {readingBook && (
        <Reader book={readingBook} onClose={() => setReadingBookId(null)} />
      )}

      <Toast />
      <TrophyBanner onOpen={() => openModal({ kind: 'trophies' })} />
    </div>
  );
}
