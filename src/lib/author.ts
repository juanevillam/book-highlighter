export const AUTHOR_CREDIT_PREFIX = 'by';
export const AUTHOR_NAME = 'juanevillam';
export const AUTHOR_URL = 'https://juanevillam.com';

const appSlug = (appName: string): string =>
  encodeURIComponent(appName.trim().toLowerCase().replace(/\s+/g, '-'));

export const authorUrl = (appName: string): string =>
  `${AUTHOR_URL}/?utm_source=${appSlug(appName)}&utm_medium=web_welcome`;

export type LegalPage = 'privacy-policy' | 'terms-and-conditions';

export const legalUrl = (
  appName: string,
  page: LegalPage,
  medium: string = 'web_welcome',
): string => {
  const slug = appSlug(appName);

  return `${AUTHOR_URL}/${slug}/${page}?utm_source=${slug}&utm_medium=${medium}`;
};
