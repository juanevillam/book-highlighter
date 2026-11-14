import { useState } from 'react';

import { thumbUrl } from '../lib/thumbUrl';

const BACKDROP_WIDTH = 64;

export function Artwork({
  artUrl,
  name,
  width,
  quickWidth,
  eager = false,
}: {
  artUrl: string;
  name: string;
  width: number;
  quickWidth?: number;
  eager?: boolean;
}) {
  const src = artUrl ? thumbUrl(artUrl, width) : '';
  const quick = artUrl && quickWidth ? thumbUrl(artUrl, quickWidth) : '';
  const backdrop = artUrl ? thumbUrl(artUrl, BACKDROP_WIDTH) : '';
  const [ready, setReady] = useState('');
  const [quickReady, setQuickReady] = useState('');
  const [backdropReady, setBackdropReady] = useState('');

  if (!src) {
    return (
      <span className="artwork is-empty" aria-hidden="true">
        <span>{name.trim().slice(0, 1) || 'B'}</span>
      </span>
    );
  }

  const landed = ready === src;

  return (
    <span className="artwork" aria-hidden="true">
      {backdrop && (
        <img
          key={`bg-${backdrop}`}
          src={backdrop}
          alt=""
          draggable={false}
          className={
            backdropReady === backdrop
              ? 'artwork-backdrop is-ready'
              : 'artwork-backdrop'
          }
          onLoad={() => setBackdropReady(backdrop)}
        />
      )}
      {!landed && ready && (
        <img
          src={ready}
          alt=""
          draggable={false}
          className="artwork-fg is-ready"
        />
      )}
      {!landed && quick && (
        <img
          key={quick}
          src={quick}
          alt=""
          draggable={false}
          className={
            quickReady === quick ? 'artwork-fg is-ready' : 'artwork-fg'
          }
          onLoad={() => setQuickReady(quick)}
        />
      )}
      <img
        key={src}
        src={src}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        className={landed ? 'artwork-fg is-ready' : 'artwork-fg'}
        onLoad={() => setReady(src)}
      />
    </span>
  );
}
