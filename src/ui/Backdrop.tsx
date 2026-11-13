import { useEffect, useRef, useState } from 'react';

import { thumbUrl } from '../lib/thumbUrl';

/**
 * Sound Shaper's FLOW, number for number (sound-shaper/web/src/ui/Backdrop
 * carries the reasoning): two copies of the cover, blurred less than the
 * still wash, turning in opposite directions about pivots off the column's
 * centre, so the colours drift and pool. There is no music here, so the
 * clock simply runs in real time; Reduce Motion keeps the still wash.
 */
const FLOW_LAYERS = [
  { periodS: 24, direction: 1, opacity: 0.85, x: -0.3, y: -0.2 },
  { periodS: 33, direction: -1, opacity: 0.7, x: 0.32, y: 0.22 },
] as const;

function useFlow(root: React.RefObject<HTMLDivElement | null>, on: boolean) {
  const phase = useRef(0);

  useEffect(() => {
    if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      // A long gap is a hidden tab coming back, not time to catch up on.
      if (dt < 100) phase.current += dt / 1000;
      root.current?.querySelectorAll<HTMLElement>('.flow').forEach(turner => {
        const layer = FLOW_LAYERS[Number(turner.dataset.layer)];
        const turn =
          ((phase.current / layer.periodS) * 360 * layer.direction) % 360;
        turner.style.transform = `rotate(${turn}deg)`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [on, root]);
}

export function StageBackdrop({ artUrl }: { artUrl: string }) {
  const src = artUrl ? thumbUrl(artUrl, 320) : '';
  const [loaded, setLoaded] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useFlow(root, Boolean(src));

  return (
    <div className="player-backdrop" aria-hidden="true" ref={root}>
      {src ? (
        <div className={loaded === src ? 'wash is-on' : 'wash'}>
          <img key={src} src={src} alt="" onLoad={() => setLoaded(src)} />
          {FLOW_LAYERS.map((layer, n) => (
            <div
              key={n}
              className="flow"
              data-layer={n}
              style={
                {
                  '--x': layer.x,
                  '--y': layer.y,
                  opacity: layer.opacity,
                } as React.CSSProperties
              }
            >
              <img src={src} alt="" />
            </div>
          ))}
        </div>
      ) : (
        <div className="standin is-on" />
      )}
      <div className="fade" />
    </div>
  );
}
