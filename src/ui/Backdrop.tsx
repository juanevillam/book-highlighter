import { useState } from 'react';

import { thumbUrl } from '../lib/thumbUrl';

export function StageBackdrop({ artUrl }: { artUrl: string }) {
  const src = artUrl ? thumbUrl(artUrl, 320) : '';
  const [loaded, setLoaded] = useState('');

  return (
    <div className="player-backdrop" aria-hidden="true">
      {src ? (
        <div className={loaded === src ? 'wash is-on' : 'wash'}>
          <img
            key={src}
            src={src}
            alt=""
            onLoad={() => setLoaded(src)}
          />
        </div>
      ) : (
        <div className="standin is-on" />
      )}
      <div className="fade" />
    </div>
  );
}
