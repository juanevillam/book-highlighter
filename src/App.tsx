import { lazy, Suspense, useEffect, useState } from 'react';

import { trackScreen } from './analytics';
import { useTheme } from './appearance';
import { t, useLocale } from './i18n';
import { AUTHOR_CREDIT_PREFIX, AUTHOR_NAME, authorUrl } from './lib/author';
import { Welcome } from './screens/Welcome';
import { signOut, useSession } from './session';
import { BrandTile } from './ui/brand';

const Home = lazy(() =>
  import('./screens/Home').then(m => ({ default: m.Home })),
);

const OWNER_EMAILS = new Set([
  'juanesvillamendoza@gmail.com',
  'juanestebanvillamemdoza@gmail.com',
]);
const OWNER_UIDS = new Set(['x6Hl4O3Dr2YKhAd00sFQmfecbFh2']);

export function App() {
  useLocale();
  useTheme();
  const session = useSession();
  const [ownerBypassed, setOwnerBypassed] = useState(false);

  useEffect(() => {
    if (session.state === 'signed-out') trackScreen('/welcome');
    else if (session.state === 'signed-in') trackScreen('/home');
  }, [session.state]);

  if (session.state === 'loading') return null;

  if (session.state === 'signed-out') return <Welcome />;

  const email = (session.user.email ?? '').trim().toLowerCase();
  const isOwner = OWNER_UIDS.has(session.user.uid) || OWNER_EMAILS.has(email);

  if (!import.meta.env.DEV && (!isOwner || !ownerBypassed)) {
    return (
      <main className="welcome">
        <section className="welcome-hero">
          <BrandTile size={88} />
          <h1>Book Highlighter</h1>
          <p className="byline">
            {AUTHOR_CREDIT_PREFIX}{' '}
            <a href={authorUrl('Book Highlighter')}>{AUTHOR_NAME}</a>
          </p>
          <div className="construction-card">
            <p className="construction-pill">
              <span className="construction-dot" aria-hidden="true" />
              {t('welcome.underConstruction.badge')}
            </p>
            <p className="construction-copy">
              {t('welcome.underConstruction.subtitle')}
            </p>
          </div>
        </section>

        <footer className="welcome-actions">
          {isOwner && (
            <button
              type="button"
              className="google"
              onClick={() => setOwnerBypassed(true)}
            >
              {t('welcome.underConstruction.enterPreview')}
            </button>
          )}
          <button
            type="button"
            className="google is-secondary"
            onClick={() => void signOut()}
          >
            {t('welcome.underConstruction.signOut')}
          </button>
        </footer>
      </main>
    );
  }

  return (
    <Suspense fallback={null}>
      <Home user={session.user} />
    </Suspense>
  );
}
