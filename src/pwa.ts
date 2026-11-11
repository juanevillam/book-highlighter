/**
 * Register the Offline-First Service Worker (`/sw.js`) in production builds so
 * the App Shell, hashed JS/CSS chunks, and Cloudinary book covers work 100% offline.
 */
export const registerServiceWorker = () => {
  if (
    !import.meta.env.PROD ||
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('Service worker registration failed:', error);
    });
  });
};
