import { useState } from 'react';

import { thumbUrl } from '../lib/thumbUrl';

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
  const [ready, setReady] = useState('');
  const [quickReady, setQuickReady] = useState('');

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
      {!landed && ready && (
        <img src={ready} alt="" draggable={false} className="is-ready" />
      )}
      {!landed && quick && (
        <img
          key={quick}
          src={quick}
          alt=""
          draggable={false}
          className={quickReady === quick ? 'is-ready' : undefined}
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
        className={landed ? 'is-ready' : undefined}
        onLoad={() => setReady(src)}
      />
    </span>
  );
}
