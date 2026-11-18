import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';

import {
  moveBook,
  moveSeries,
  renormalizeShelfOrder,
  setAddTilePosition,
  type Book,
} from '../books';
import { t } from '../i18n';
import {
  DRAG_ACTIVE_SCALE,
  positionForMove,
  renormalized,
} from '../lib/gridOrder';
import { type ShelfEntry } from '../lib/shelf';

import { Artwork } from './Artwork';
import { PlusGlyph } from './glyphs';
import { showToast } from './Toast';

const TILE_WIDTH = 220;

const ADD_KEY = '__add__';

/** How long a press is held before the tile lifts: the app's long press. */
const HOLD_MS = 400;

/** How far a press may wander before it is a scroll, not a hold. */
const SLOP_PX = 8;

/** Within this of the scroller's edge, a dragged tile scrolls the grid. */
const EDGE_PX = 72;

type Cell =
  | { key: string; kind: 'book'; book: Book; position: number | null }
  | {
      key: string;
      kind: 'series';
      name: string;
      books: Book[];
      position: number | null;
    }
  | { key: string; kind: 'add'; position: number | null };

const toCells = (
  entries: ShelfEntry[],
  addTilePosition: number | null,
): Cell[] => {
  const cells: Cell[] = entries.map(entry =>
    entry.kind === 'book'
      ? {
          key: entry.book.id,
          kind: 'book',
          book: entry.book,
          position: entry.position,
        }
      : {
          key: `series:${entry.name}`,
          kind: 'series',
          name: entry.name,
          books: entry.books,
          position: entry.position,
        },
  );
  const add: Cell = { key: ADD_KEY, kind: 'add', position: addTilePosition };

  if (addTilePosition === null) return [add, ...cells];

  const slot = cells.findIndex(
    cell => cell.position !== null && cell.position > addTilePosition,
  );

  return slot === -1
    ? [...cells, add]
    : [...cells.slice(0, slot), add, ...cells.slice(slot)];
};

/** What scrolls the grid: the desk's library column, else the page. */
const scrollerOf = (el: HTMLElement): HTMLElement => {
  const library = el.closest<HTMLElement>('.library');
  if (library && library.scrollHeight > library.clientHeight + 1)
    return library;
  return document.scrollingElement as HTMLElement;
};

type Drag = {
  key: string;
  pointerId: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  grabX: number;
  grabY: number;
  width: number;
  height: number;
  timer: ReturnType<typeof setTimeout> | null;
  lifted: boolean;
  from: number;
  scroller: HTMLElement | null;
  frame: number;
};

export function LibraryGrid({
  entries,
  addTilePosition,
  hasSettled,
  error,
  selectedBookId,
  onSelectBook,
  onEditBook,
  onSelectSeries,
  onNewBook,
}: {
  entries: ShelfEntry[];
  addTilePosition: number | null;
  hasSettled: boolean;
  error: Error | null;
  selectedBookId: string | null;
  onSelectBook: (book: Book) => void;
  onEditBook: (book: Book) => void;
  onSelectSeries: (name: string) => void;
  onNewBook: () => void;
}) {
  const cells = useMemo(
    () => toCells(entries, addTilePosition),
    [entries, addTilePosition],
  );
  const byKey = useMemo(
    () => new Map(cells.map(cell => [cell.key, cell])),
    [cells],
  );
  const entriesByKey = useMemo(
    () =>
      new Map(
        entries.map(entry => [
          entry.kind === 'book' ? entry.book.id : `series:${entry.name}`,
          entry,
        ]),
      ),
    [entries],
  );

  const [order, setOrder] = useState<string[] | null>(null);
  const orderRef = useRef<string[] | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const keys = order ?? cells.map(cell => cell.key);

  const list = useRef<HTMLUListElement>(null);
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);
  const slots = useRef(new Map<string, { left: number; top: number }>());
  const anims = useRef(new Map<string, Animation>());

  useEffect(() => {
    if (!hasSettled || entered) return;
    const id = setTimeout(() => setEntered(true), 750);
    return () => clearTimeout(id);
  }, [hasSettled, entered]);

  const live = cells.map(cell => cell.key).join('|');
  useEffect(() => {
    if (order && !lifted && order.join('|') === live) {
      orderRef.current = null;
      setOrder(null);
    }
  }, [live, order, lifted]);

  const items = () => [...(list.current?.children ?? [])] as HTMLLIElement[];

  const snapshotSlots = () => {
    slots.current.clear();
    for (const li of items()) {
      const key = li.dataset.key;
      if (key) {
        slots.current.set(key, { left: li.offsetLeft, top: li.offsetTop });
      }
    }
  };

  const follow = () => {
    const d = drag.current;
    const host = list.current;
    if (!d?.lifted || !host) return;
    const li = items().find(el => el.dataset.key === d.key);
    if (!li) return;
    const running = anims.current.get(d.key);
    if (running) {
      running.cancel();
      anims.current.delete(d.key);
    }
    const hostRect = host.getBoundingClientRect();
    const slotLeft = hostRect.left + li.offsetLeft;
    const slotTop = hostRect.top + li.offsetTop;
    const dx = d.x - d.grabX - slotLeft;
    const dy = d.y - d.grabY - slotTop;
    li.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  };

  const retarget = () => {
    const d = drag.current;
    const host = list.current;
    if (!d?.lifted || !host) return;
    const hostRect = host.getBoundingClientRect();
    const listItems = items();
    const to = listItems.findIndex(el => {
      const w = el.offsetWidth;
      const h = Math.max(el.offsetHeight, d.height);
      const ix = w * 0.12;
      const iy = h * 0.12;
      const left = hostRect.left + el.offsetLeft + ix;
      const right = hostRect.left + el.offsetLeft + w - ix;
      const top = hostRect.top + el.offsetTop + iy;
      const bottom = hostRect.top + el.offsetTop + h - iy;
      return d.x >= left && d.x <= right && d.y >= top && d.y <= bottom;
    });
    if (to === -1) return;
    const current = orderRef.current ?? keys;
    const from = current.indexOf(d.key);
    if (from === -1 || from === to) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, d.key);
    orderRef.current = next;
    flushSync(() => {
      setOrder(next);
    });
  };

  useLayoutEffect(() => {
    const host = list.current;
    if (!host) return;
    if (!drag.current?.lifted) {
      snapshotSlots();
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const li of items()) {
      const key = li.dataset.key ?? '';
      const now = { left: li.offsetLeft, top: li.offsetTop };
      const was = slots.current.get(key);
      slots.current.set(key, now);
      if (!was || key === drag.current.key || reduce) continue;
      let dx = was.left - now.left;
      let dy = was.top - now.top;
      if (!dx && !dy) continue;

      const prevAnim = anims.current.get(key);
      if (prevAnim && prevAnim.playState === 'running') {
        const r = li.getBoundingClientRect();
        const tx = r.left - hostRect.left - now.left;
        const ty = r.top - hostRect.top - now.top;
        dx = was.left - now.left + tx;
        dy = was.top - now.top + ty;
        prevAnim.cancel();
      }
      if (!dx && !dy) continue;

      const anim = li.animate(
        [
          { transform: `translate3d(${dx}px, ${dy}px, 0)` },
          { transform: 'none' },
        ],
        { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
      anim.onfinish = () => {
        if (anims.current.get(key) === anim) anims.current.delete(key);
      };
      anims.current.set(key, anim);
    }
    follow();
  });

  const autoScroll = () => {
    const d = drag.current;
    if (!d?.lifted || !d.scroller) return;
    const scroller = d.scroller;
    const page = scroller === document.scrollingElement;
    const top = page ? 0 : scroller.getBoundingClientRect().top;
    const bottom = page
      ? window.innerHeight
      : scroller.getBoundingClientRect().bottom;
    const step =
      d.y < top + EDGE_PX
        ? -Math.ceil(((top + EDGE_PX - d.y) / EDGE_PX) * 14)
        : d.y > bottom - EDGE_PX
          ? Math.ceil(((d.y - (bottom - EDGE_PX)) / EDGE_PX) * 14)
          : 0;
    if (step) {
      scroller.scrollTop += step;
      retarget();
      follow();
    }
    d.frame = requestAnimationFrame(autoScroll);
  };

  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    cancelAnimationFrame(d.frame);
    if (!d.lifted) return;

    swallowClick.current = true;
    const li = items().find(el => el.dataset.key === d.key);
    if (li) {
      const from = li.style.transform;
      li.style.transform = '';
      if (from) {
        li.style.zIndex = '10';
        const anim = li.animate([{ transform: from }, { transform: 'none' }], {
          duration: 220,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        });
        anim.onfinish = () => {
          li.style.zIndex = '';
          if (anims.current.get(d.key) === anim) anims.current.delete(d.key);
        };
        anims.current.set(d.key, anim);
      }
    }
    setLifted(null);

    const final = orderRef.current ?? order ?? keys;
    const to = final.indexOf(d.key);
    if (!commit || to === d.from) {
      orderRef.current = null;
      setOrder(null);
      const cell = byKey.get(d.key);
      if (commit && cell?.kind === 'book') onEditBook(cell.book);
      else if (commit && cell?.kind === 'series') onSelectSeries(cell.name);
      return;
    }

    void persist(final, to, d.key);
  };

  const persist = async (final: string[], to: number, key: string) => {
    const data = final.map(k => ({
      id: k,
      position: byKey.get(k)?.position ?? null,
    }));
    const cell = byKey.get(key);
    try {
      const position = positionForMove(data, to);
      if (position === null) {
        await renormalizeShelfOrder(renormalized(data), entriesByKey, ADD_KEY);
      } else if (key === ADD_KEY) {
        await setAddTilePosition(position);
      } else if (cell?.kind === 'book') {
        await moveBook(cell.book.id, position);
      } else if (cell?.kind === 'series') {
        await moveSeries(
          cell.books.map(b => b.id),
          position,
        );
      }
    } catch (err) {
      console.warn('reorder', err);
      showToast(t('snackbar.reorder-failed'));
      orderRef.current = null;
      setOrder(null);
    }
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.x = e.clientX;
      d.y = e.clientY;
      if (!d.lifted) {
        if (Math.hypot(d.x - d.x0, d.y - d.y0) > SLOP_PX) end(false);
        return;
      }
      e.preventDefault();
      retarget();
      follow();
    };
    const up = (e: PointerEvent) => {
      if (drag.current?.pointerId === e.pointerId) end(true);
    };
    const cancel = (e: PointerEvent) => {
      if (drag.current?.pointerId === e.pointerId) end(false);
    };
    const touch = (e: TouchEvent) => {
      if (drag.current?.lifted) e.preventDefault();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag.current?.lifted) {
        e.stopPropagation();
        end(false);
      }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', touch, { passive: false });
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', touch);
      window.removeEventListener('keydown', key, true);
    };
  });

  const press = (e: React.PointerEvent<HTMLLIElement>, key: string) => {
    if (e.button !== 0 || drag.current) return;
    const li = e.currentTarget;
    const r = li.getBoundingClientRect();
    const d: Drag = {
      key,
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      grabX: e.clientX - r.left,
      grabY: e.clientY - r.top,
      width: r.width,
      height: r.height,
      timer: null,
      lifted: false,
      from: keys.indexOf(key),
      scroller: null,
      frame: 0,
    };
    d.timer = setTimeout(() => {
      d.timer = null;
      snapshotSlots();
      d.lifted = true;
      d.scroller = scrollerOf(li);
      navigator.vibrate?.(10);
      const initial = [...keys];
      orderRef.current = initial;
      flushSync(() => {
        setOrder(initial);
        setLifted(key);
      });
      follow();
      d.frame = requestAnimationFrame(autoScroll);
    }, HOLD_MS);
    drag.current = d;
  };

  if (error) {
    return (
      <div className="empty">
        <h2>{t('home.error.title')}</h2>
        <p>{t('home.error.subtitle')}</p>
      </div>
    );
  }

  if (!hasSettled) {
    return (
      <ul className="grid" aria-busy="true">
        {Array.from({ length: 6 }).map((_, idx) => (
          <li key={idx}>
            <div className="tile">
              <span className="tile-art bone" />
              <span className="bone line" />
              <span className="bone line short" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const renderTile = (cell: Cell): ReactNode => {
    if (cell.kind === 'add') {
      return (
        <button type="button" className="tile is-add" onClick={onNewBook}>
          <span className="tile-art">
            <span className="artwork is-empty" aria-hidden="true">
              <PlusGlyph />
            </span>
          </span>
          <span className="tile-name">{t('app.bookNew')}</span>
        </button>
      );
    }

    if (cell.kind === 'book') {
      const { book } = cell;
      const active = book.id === selectedBookId;
      return (
        <button
          type="button"
          className={active ? 'tile is-active' : 'tile'}
          onClick={() => onSelectBook(book)}
        >
          <span className="tile-art">
            <Artwork artUrl={book.artUrl} name={book.name} width={TILE_WIDTH} />
          </span>
          <span className="tile-name">{book.name}</span>
          {book.author && <span className="tile-sub">{book.author}</span>}
        </button>
      );
    }

    const { name, books } = cell;
    const topBook = books[0];
    const behind = books.slice(1, 3);
    const containsSelected = books.some(b => b.id === selectedBookId);

    return (
      <button
        type="button"
        className={containsSelected ? 'tile is-active' : 'tile'}
        onClick={() => onSelectSeries(name)}
      >
        <span
          className="tile-art series-stack"
          style={{ '--depth': behind.length } as React.CSSProperties}
        >
          {behind
            .slice()
            .reverse()
            .map((layerBook, revIdx) => {
              const step = behind.length - revIdx;
              return (
                <span
                  key={layerBook.id}
                  className="series-layer"
                  style={{ '--step': step } as React.CSSProperties}
                  aria-hidden="true"
                >
                  <Artwork
                    artUrl={layerBook.artUrl}
                    name={layerBook.name}
                    width={TILE_WIDTH}
                  />
                </span>
              );
            })}
          <span className="series-front">
            <Artwork
              artUrl={topBook.artUrl}
              name={topBook.name}
              width={TILE_WIDTH}
            />
            <span className="series-badge">{books.length}</span>
          </span>
        </span>
        <span className="tile-name">{name}</span>
        {topBook.author && <span className="tile-sub">{topBook.author}</span>}
      </button>
    );
  };

  const gridClass = [
    'grid',
    entered ? 'is-entered' : '',
    lifted ? 'is-sorting' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ul
      ref={list}
      className={gridClass}
      onClickCapture={e => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      onContextMenu={e => {
        if (drag.current) e.preventDefault();
      }}
    >
      {keys.map((key, idx) => {
        const cell = byKey.get(key);
        if (!cell) return null;
        return (
          <li
            key={key}
            data-key={key}
            className={lifted === key ? 'is-lifted' : undefined}
            style={
              {
                '--i': Math.min(idx, 24),
                viewTransitionName:
                  cell.key === ADD_KEY
                    ? 'tile-add'
                    : cell.kind === 'book'
                      ? `tile-${cell.book.id}`
                      : `tile-series-${idx}`,
              } as React.CSSProperties
            }
            onPointerDown={e => press(e, key)}
          >
            {renderTile(cell)}
          </li>
        );
      })}
    </ul>
  );
}
