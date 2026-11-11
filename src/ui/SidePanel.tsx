import { useEffect, useRef, useState, type ReactNode } from 'react';

import { t } from '../i18n';

import { CloseGlyph } from './glyphs';

const DISMISS_PX = 120;
const DISMISS_VELOCITY = 0.6;

export function SidePanel({
  open,
  depth = 0,
  index = 0,
  title,
  action,
  trailing,
  onClose,
  children,
}: {
  open: boolean;
  depth?: number;
  index?: number;
  title: string;
  action?: ReactNode;
  trailing?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const form = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState(false);
  const [pull, setPull] = useState<number | null>(null);
  const grab = useRef<{ y: number; t: number; id: number } | null>(null);

  const [raised, setRaised] = useState(false);
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setRaised(true));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (form.current) form.current.scrollTop = 0;
    setEdge(false);
  }, [title]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea'))
      return;
    grab.current = { y: e.clientY, t: performance.now(), id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPull(0);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!grab.current || grab.current.id !== e.pointerId) return;
    const dy = e.clientY - grab.current.y;
    setPull(dy > 0 ? dy : dy / 6);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const start = grab.current;
    grab.current = null;
    if (!start) return;
    const dy = e.clientY - start.y;
    const velocity = dy / Math.max(1, performance.now() - start.t);
    setPull(null);
    if (dy > DISMISS_PX || (dy > 24 && velocity > DISMISS_VELOCITY)) onClose();
  };

  const style = {
    '--index': index,
    ...(pull !== null
      ? { '--pull': `${Math.max(pull, -12)}px`, transition: 'none' }
      : null),
  } as React.CSSProperties;

  return (
    <aside
      className={[
        'side',
        index === 0 ? 'is-base' : '',
        open && raised ? 'is-open' : '',
        depth > 0 ? 'is-under' : '',
        depth > 1 ? 'is-deep' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      aria-label={title}
      aria-hidden={!open || depth > 0}
      inert={!open || depth > 0}
    >
      <header
        className={edge ? 'side-bar is-edge' : 'side-bar'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          grab.current = null;
          setPull(null);
        }}
      >
        <span className="side-grabber" aria-hidden="true" />
        <span className="side-lead">{action}</span>
        <h2>{title}</h2>
        {trailing ?? (
          <button type="button" className="round" onClick={onClose}>
            <CloseGlyph />
            <span className="sr">{t('common.close')}</span>
          </button>
        )}
      </header>
      <div
        ref={form}
        className="form"
        onScroll={e => setEdge(e.currentTarget.scrollTop > 0)}
      >
        {children}
      </div>
    </aside>
  );
}
