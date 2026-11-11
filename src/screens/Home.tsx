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
import { BookFormPanel } from '../ui/BookForm';
import { BookStage } from '../ui/BookStage';
import { ChaptersPanel } from '../ui/ChaptersForm';
import { ExportPanel } from '../ui/ExportForm';
import { GearGlyph } from '../ui/glyphs';
import { LibraryGrid } from '../ui/LibraryGrid';
import { Reader } from '../ui/Reader';
import { ScannerSheet } from '../ui/ScannerSheet';
import { SeriesSheet } from '../ui/SeriesSheet';
import { SettingsForm } from '../ui/SettingsForm';
import { SidePanel } from '../ui/SidePanel';
import { Toast } from '../ui/Toast';
import { TrashSheet } from '../ui/TrashSheet';
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

type Entry =
  | { kind: 'settings' | 'account' | 'trophies' | 'trash' }
  | { kind: 'series'; name: string }
  | { kind: 'bookForm'; book: Book | null }
  | { kind: 'export'; book: Book | null }
  | { kind: 'chapters'; bookId: string }
  | { kind: 'scanner'; targetBook: Book | null };

type Layer = {
  id: number;
  entry: Entry;
  leaving: boolean;
  tools: boolean;
};

const isToolEntry = (_entry: Entry) => false;

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
  const [layers, setLayers] = useState<Layer[]>([]);
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

  const live = layers.filter(layer => !layer.leaving);
  const base = live[0]?.entry.kind ?? null;

  const [stood, setStood] = useState(false);
  const hasCurrent = Boolean(selectedBook);

  useEffect(() => {
    if (hasCurrent === stood) return;
    if (live.length) setStood(hasCurrent);
    else morph(() => setStood(hasCurrent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCurrent, stood]);

  const tooled = live.some(layer => layer.tools);
  const [toolsShown, setToolsShown] = useState(false);
  useEffect(() => {
    if (tooled !== toolsShown) morph(() => setToolsShown(tooled));
  }, [tooled, toolsShown]);

  const overStage = live.filter(layer => !layer.tools);

  const leave = (keep: (layer: Layer, index: number) => boolean) => {
    setLayers(all =>
      all.map((layer, i) =>
        layer.leaving || keep(layer, i) ? layer : { ...layer, leaving: true },
      ),
    );
    window.setTimeout(
      () => setLayers(all => all.filter(layer => !layer.leaving)),
      LEAVE_MS,
    );
  };

  const push = (entry: Entry) =>
    setLayers(all => {
      const front = all.find(layer => !layer.leaving);
      const useToolsColumn = front
        ? front.tools
        : isToolEntry(entry) && Boolean(selectedBook);
      return [
        ...all,
        {
          id: (nextLayerId += 1),
          entry,
          leaving: false,
          tools: useToolsColumn,
        },
      ];
    });

  const pop = () => {
    const front = live[live.length - 1];
    if (front) leave(layer => layer.id !== front.id);
  };

  const closeAll = () => leave(() => false);

  const openOnly = (entry: Entry) => {
    if (
      live.length === 1 &&
      base === entry.kind &&
      entry.kind !== 'bookForm' &&
      entry.kind !== 'scanner' &&
      entry.kind !== 'series'
    ) {
      closeAll();
      return;
    }
    leave(() => false);
    push(entry);
  };

  const stageThen = (change: () => void) =>
    stood || live.length ? change() : morph(change);

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
      if (live.length) pop();
      else setMobileStageOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const staged = stood || live.length > 0;
  const className = [
    'home',
    selectedBook ? 'has-current' : '',
    staged ? 'is-staged' : '',
    mobileStageOpen ? 'is-expanded' : '',
    overStage.length ? 'side-open' : '',
    toolsShown && staged ? 'is-tooled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const renderLayer = (layer: Layer, indexInGroup: number, depth: number) => {
    const isOpen = !layer.leaving;
    const effectiveDepth = layer.leaving ? 0 : depth;
    const handleClose = layer.leaving ? () => {} : pop;
    const { entry } = layer;

    switch (entry.kind) {
      case 'bookForm':
        return (
          <BookFormPanel
            key={layer.id}
            open={isOpen}
            depth={effectiveDepth}
            index={indexInGroup}
            book={entry.book}
            onSaved={bookId => {
              setSelectedBookId(bookId);
              setMobileStageOpen(true);
              closeAll();
            }}
            onDeleted={() => {
              closeAll();
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
            depth={effectiveDepth}
            index={indexInGroup}
            initialBook={entry.book}
            onClose={handleClose}
          />
        );

      case 'scanner':
        return (
          <ScannerSheet
            key={layer.id}
            open={isOpen}
            depth={effectiveDepth}
            index={indexInGroup}
            targetBook={entry.targetBook}
            onSaved={bookId => {
              setSelectedBookId(bookId);
              setMobileStageOpen(true);
              closeAll();
            }}
            onClose={handleClose}
          />
        );

      case 'settings':
        return (
          <SidePanel
            key={layer.id}
            open={isOpen}
            depth={effectiveDepth}
            index={indexInGroup}
            title={t('app.settings')}
            onClose={handleClose}
          >
            <SettingsForm
              user={user}
              onAccount={() => push({ kind: 'account' })}
            />
          </SidePanel>
        );

      case 'account':
        return (
          <SidePanel
            key={layer.id}
            open={isOpen}
            depth={effectiveDepth}
            index={indexInGroup}
            title={t('settings.account.sheetTitle')}
            onClose={handleClose}
          >
            <AccountForm
              user={user}
              onChanged={() => setProfileTick(n => n + 1)}
              onTrophies={() => push({ kind: 'trophies' })}
              onTrash={() => push({ kind: 'trash' })}
              onExportAll={() => push({ kind: 'export', book: null })}
            />
          </SidePanel>
        );

      case 'trophies':
        return (
          <SidePanel
            key={layer.id}
            open={isOpen}
            depth={effectiveDepth}
            index={indexInGroup}
            title={t('trophies.title')}
            onClose={handleClose}
          >
            <TrophiesForm />
          </SidePanel>
        );

      case 'trash':
        return (
          <SidePanel
            key={layer.id}
            open={isOpen}
            depth={effectiveDepth}
            index={indexInGroup}
            title={t('trash.title')}
            onClose={handleClose}
          >
            <TrashSheet />
          </SidePanel>
        );

      case 'series': {
        const seriesBooks = shelf.filter(b => b.series === entry.name);
        return (
          <SidePanel
            key={layer.id}
            open={isOpen}
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
                closeAll();
              }}
            />
          </SidePanel>
        );
      }
    }
  };

  const renderSheetGroup = (tools: boolean) => {
    const group = layers.filter(layer => layer.tools === tools);
    const front = group.filter(layer => !layer.leaving);
    return group.map((layer, idx) => {
      const depth = front.length - 1 - front.indexOf(layer);
      return renderLayer(layer, idx, depth);
    });
  };

  return (
    <div className={className}>
      <main className="library">
        <header className={titled ? 'bar is-edge is-titled' : 'bar'}>
          <span className="bar-lead" aria-hidden="true" />

          <span className="bar-title" aria-hidden={!titled}>
            {APP_NAME}
          </span>

          <button
            type="button"
            className="round bar-glyph"
            aria-expanded={base === 'settings'}
            onClick={() => stageThen(() => openOnly({ kind: 'settings' }))}
          >
            <GearGlyph />
            <span className="sr">{t('app.settings')}</span>
          </button>
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
            stageThen(() => {
              setSelectedBookId(book.id);
              setMobileStageOpen(true);
            });
          }}
          onSelectSeries={name =>
            stageThen(() => openOnly({ kind: 'series', name }))
          }
          onScanNewBook={() =>
            stageThen(() => openOnly({ kind: 'scanner', targetBook: null }))
          }
        />
      </main>

      <div className="stage">
        {selectedBook && (
          <BookStage
            book={selectedBook}
            onCloseMobile={() => setMobileStageOpen(false)}
            onRead={() => setReadingBookId(selectedBook.id)}
            onScanPages={() =>
              stageThen(() =>
                openOnly({ kind: 'scanner', targetBook: selectedBook }),
              )
            }
            onOpenChapters={() =>
              stageThen(() =>
                openOnly({ kind: 'chapters', bookId: selectedBook.id }),
              )
            }
            onEditBook={() =>
              stageThen(() =>
                openOnly({ kind: 'bookForm', book: selectedBook }),
              )
            }
            onExportBook={() =>
              stageThen(() => openOnly({ kind: 'export', book: selectedBook }))
            }
          />
        )}

        {renderSheetGroup(false)}
      </div>

      <div className="tools">{renderSheetGroup(true)}</div>

      {readingBook && (
        <Reader book={readingBook} onClose={() => setReadingBookId(null)} />
      )}

      <Toast />
      <TrophyBanner
        onOpen={() => stageThen(() => openOnly({ kind: 'trophies' }))}
      />
    </div>
  );
}
