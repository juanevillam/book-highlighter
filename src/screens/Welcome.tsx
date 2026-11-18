import { useState } from 'react';

import { isFirebaseConfigured } from '../firebaseConfig';
import { t } from '../i18n';
import {
  AUTHOR_CREDIT_PREFIX,
  AUTHOR_NAME,
  authorUrl,
  legalUrl,
} from '../lib/author';
import { signInWithGoogle } from '../session';
import { BrandTile } from '../ui/brand';
import {
  GoogleG,
  HighlightsFeatureIcon,
  LibraryFeatureIcon,
  ReadFeatureIcon,
} from '../ui/icons';

const APP_NAME = 'Book Highlighter';

const FEATURES = [
  { key: 'library', Icon: LibraryFeatureIcon },
  { key: 'read', Icon: ReadFeatureIcon },
  { key: 'highlights', Icon: HighlightsFeatureIcon },
] as const;

export function Welcome() {
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<
    'errors.message' | 'errors.firebaseMissing' | null
  >(null);

  const signIn = async () => {
    if (!isFirebaseConfigured) {
      setErrorKey('errors.firebaseMissing');
      return;
    }
    setBusy(true);
    setErrorKey(null);
    try {
      await signInWithGoogle();
    } catch (error) {
      console.warn('signInWithGoogle', error);
      setErrorKey('errors.message');
    } finally {
      setBusy(false);
    }
  };

  const [before, rest] = t('welcome.legal.text').split('{privacy}');
  const [between, after] = (rest ?? '').split('{terms}');

  return (
    <main className="welcome">
      <section className="welcome-hero">
        <BrandTile size={88} />
        <h1>{APP_NAME}</h1>
        <p className="byline">
          {AUTHOR_CREDIT_PREFIX} <a href={authorUrl(APP_NAME)}>{AUTHOR_NAME}</a>
        </p>
        <ul className="features">
          {FEATURES.map(({ key, Icon }) => (
            <li key={key}>
              <span className="feature-icon">
                <Icon />
              </span>
              <span>
                <strong>{t(`welcome.features.${key}.title`)}</strong>
                <span>{t(`welcome.features.${key}.subtitle`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="welcome-actions">
        <button
          type="button"
          className="google"
          disabled={busy}
          onClick={() => void signIn()}
        >
          <GoogleG />
          {busy
            ? t('welcome.button.google.loadingLabel')
            : t('welcome.button.google.label')}
        </button>
        {errorKey && (
          <p className="error" role="alert">
            {t(errorKey)}
          </p>
        )}
        <p className="legal">
          {before}
          <a href={legalUrl(APP_NAME, 'privacy-policy', 'web_welcome')}>
            {t('welcome.legal.privacy')}
          </a>
          {between}
          <a href={legalUrl(APP_NAME, 'terms-and-conditions', 'web_welcome')}>
            {t('welcome.legal.terms')}
          </a>
          {after}
        </p>
      </footer>
    </main>
  );
}
