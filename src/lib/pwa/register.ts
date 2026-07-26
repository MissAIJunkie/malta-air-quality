/**
 * Service-worker registration.
 *
 * Registration is production-only and deliberately so: a worker that intercepts
 * every request fights Fast Refresh, and a stale cached bundle in development
 * looks exactly like a bug in the code you just changed. `NODE_ENV` is inlined
 * into the client bundle at build time, so this check costs nothing at runtime.
 *
 * Nothing here throws. A browser without service workers, a page served over
 * plain HTTP, or a user profile that blocks registration must all degrade to a
 * perfectly ordinary online-only application.
 */

export const SERVICE_WORKER_PATH = '/sw.js';

export function isServiceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/**
 * Register the worker, if this environment should have one.
 *
 * @returns the registration, or `null` when registration was skipped or failed.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (process.env.NODE_ENV !== 'production') return null;
  if (!isServiceWorkerSupported()) return null;

  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: '/' });
  } catch {
    // Offline support is an enhancement. Losing it is not worth a console error
    // on a page that otherwise works.
    return null;
  }
}

/**
 * Ask a waiting worker to take over immediately.
 *
 * Without this an update sits idle until every tab is closed, which for a page
 * people leave open all day can be days. Paired with the `SKIP_WAITING` handler
 * in `public/sw.js`.
 */
export async function activateWaitingServiceWorker(): Promise<void> {
  if (!isServiceWorkerSupported()) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.waiting?.postMessage('SKIP_WAITING');
  } catch {
    // Nothing to do — the update applies on the next visit instead.
  }
}

/**
 * Remove any registered worker and drop its caches.
 *
 * Kept because a shipped worker is otherwise very hard to retract: without a
 * deliberate un-registration path, a bad release stays resident on every device
 * that ever loaded it.
 */
export async function unregisterServiceWorker(): Promise<void> {
  if (!isServiceWorkerSupported()) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith('maqua-')).map((name) => caches.delete(name)),
      );
    }
  } catch {
    // Best effort.
  }
}
