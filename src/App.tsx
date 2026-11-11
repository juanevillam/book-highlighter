import { lazy, Suspense, useEffect } from 'react';

import { trackScreen } from './analytics';
import { useTheme } from './appearance';
import { useLocale } from './i18n';
import { Welcome } from './screens/Welcome';
import { useSession } from './session';

const Home = lazy(() =>
  import('./screens/Home').then(m => ({ default: m.Home })),
);

export function App() {
  useLocale();
  useTheme();
  const session = useSession();

  useEffect(() => {
    if (session.state === 'signed-out') trackScreen('/welcome');
    else if (session.state === 'signed-in') trackScreen('/home');
  }, [session.state]);

  if (session.state === 'loading') return null;

  if (session.state === 'signed-out') return <Welcome />;

  return (
    <Suspense fallback={null}>
      <Home user={session.user} />
    </Suspense>
  );
}
