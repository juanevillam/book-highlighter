import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';

import { trackScreen } from './analytics';
import { useTheme } from './appearance';
import { t, useLocale } from './i18n';
import { Welcome } from './screens/Welcome';
import { useSession } from './session';

const Home = lazy(() =>
  import('./screens/Home').then(m => ({ default: m.Home })),
);

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="error" style={{ minHeight: '100svh' }}>
        <p>{t('errors.message')}</p>
        <button
          type="button"
          className="pill"
          onClick={() => window.location.reload()}
        >
          {t('errors.retry')}
        </button>
      </main>
    );
  }
}

export function App() {
  useLocale();
  useTheme();
  const session = useSession();

  useEffect(() => {
    if (session.state === 'signed-out') trackScreen('/welcome');
    else if (session.state === 'signed-in') trackScreen('/home');
  }, [session.state]);

  if (session.state === 'loading') return null;

  return (
    <ErrorBoundary>
      {session.state === 'signed-in' ? (
        <Suspense fallback={null}>
          <Home key={session.user.uid} user={session.user} />
        </Suspense>
      ) : (
        <Welcome />
      )}
    </ErrorBoundary>
  );
}
