/*
 * maqua.app service worker.
 *
 * Plain JavaScript, served as-is: it is not part of the module graph, so it
 * cannot import the dictionary, the formatters or anything else from `src/`.
 * The two header names below are duplicated in `src/lib/pwa/offline.ts` and the
 * pair must stay in step — that module is the only thing that reads them.
 *
 * ## The rule this file exists to keep
 *
 * A cached reading must never be presented as a current one.
 *
 * That is not automatic. A stored `/api/air-quality` response was fresh at the
 * moment it was stored: its envelope says `stale: false` and `cached: false`,
 * and replaying it verbatim while offline would hand the interface a payload
 * that describes itself as live. So the offline path REWRITES the envelope
 * before responding — `stale: true`, `cached: true`, `degradedReason: "offline"`
 * — and attaches the instant the copy was downloaded.
 *
 * If that rewrite cannot be done (the body will not parse, or does not look like
 * the expected envelope) the request fails with a 503 instead. Serving a payload
 * whose own metadata lies about its age is worse than serving nothing.
 *
 * ## Cached page HTML
 *
 * Pages are server-rendered and contain readings in their markup, so a page
 * served from cache shows figures that were current when it was downloaded. This
 * is a real trade: an offline station page is genuinely useful, and the
 * alternative — no offline pages at all — helps nobody. It is safe only because
 * the offline indicator mounts on every page, states the downloaded and measured
 * instants, and says the readings cannot be refreshed. Do not remove that
 * component while this caching stays.
 */

const VERSION = 'v1';
const SHELL_CACHE = `maqua-shell-${VERSION}`;
const DATA_CACHE = `maqua-data-${VERSION}`;
const ASSET_CACHE = `maqua-assets-${VERSION}`;

const EXPECTED_CACHES = [SHELL_CACHE, DATA_CACHE, ASSET_CACHE];

/** ISO-8601 instant this device downloaded the cached copy. */
const CACHED_AT_HEADER = 'x-maqua-cached-at';
/** Present only on a response the worker served from cache while offline. */
const OFFLINE_HEADER = 'x-maqua-offline';

/** The only API response worth having offline. Everything else is per-request. */
const READINGS_PATH = '/api/air-quality';

/** The shell precached at install, so a first offline navigation has something. */
const SHELL_PATH = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      /*
       * `cache.addAll` rejects — and aborts the whole installation — if any one
       * request fails. Adding entries individually and ignoring failures means a
       * slow network at install time costs the precache, not the worker.
       */
      await Promise.allSettled([cache.add(SHELL_PATH)]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('maqua-') && !EXPECTED_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  // Lets a page apply an update without waiting for every tab to close.
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only ever GET. A POST is a state change and must reach the server or fail
  // visibly; replaying one from a cache would be a bug with consequences.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin is passed straight through. Map tiles in particular are opaque
  // responses that would consume a large quota for little benefit, and OSM's
  // usage policy discourages bulk caching.
  if (url.origin !== self.location.origin) return;

  if (url.pathname === READINGS_PATH) {
    event.respondWith(handleReadings(request));
    return;
  }

  /*
   * Every other API path is network-only.
   *
   * `/api/cron/*` and `/api/alerts/*` carry credentials or one-time tokens,
   * `/api/health` is a live probe and would be worthless cached, and
   * `/api/explain`, `/api/context` and `/api/forecast` are all per-request. None
   * of them may ever be answered from a store.
   */
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isCacheableAsset(url)) {
    event.respondWith(handleAsset(request));
  }
});

/** Static files safe to serve from a store. */
function isCacheableAsset(url) {
  // Never the worker itself: a cached copy would pin the device to an old
  // offline strategy, and this is the one file that must always be revalidated.
  if (url.pathname === '/sw.js') return false;

  return (
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|avif|ico)$/.test(url.pathname)
  );
}

function withHeader(response, name, value) {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/* -------------------------------------------------------------------------- */
/*  Readings                                                                  */
/* -------------------------------------------------------------------------- */

async function handleReadings(request) {
  const cache = await caches.open(DATA_CACHE);

  try {
    const response = await fetch(request);

    if (response.ok) {
      // Stamped on the way in, because the download instant is not recoverable
      // afterwards and it is one of the four things the offline state has to
      // show. The body is read as text and rebuilt so the stored copy carries
      // the extra header.
      const body = await response.clone().text();
      const headers = new Headers(response.headers);
      headers.set(CACHED_AT_HEADER, new Date().toISOString());
      await cache.put(
        request,
        new Response(body, { status: response.status, statusText: response.statusText, headers }),
      );
    }

    return response;
  } catch {
    const cached = await cache.match(request);
    if (!cached) {
      return offlineFailure('No readings have been downloaded on this device yet.');
    }
    return degradeCachedReadings(cached);
  }
}

/**
 * Rewrite a stored envelope so it describes itself truthfully.
 *
 * The measurement instant is left exactly as it was — that fact has not changed
 * and is what the interface shows as "measured at". Only the claims about
 * freshness are corrected.
 */
async function degradeCachedReadings(cached) {
  const cachedAt = cached.headers.get(CACHED_AT_HEADER);

  let payload;
  try {
    payload = JSON.parse(await cached.clone().text());
  } catch {
    return offlineFailure('The stored readings could not be read.');
  }

  if (!payload || typeof payload !== 'object' || typeof payload.meta !== 'object' || !payload.meta) {
    // Not the envelope this worker knows how to annotate. Refusing is the only
    // safe answer: an un-annotated payload would present itself as live.
    return offlineFailure('The stored readings are in an unrecognised format.');
  }

  payload.meta.stale = true;
  payload.meta.cached = true;
  payload.meta.degradedReason = 'offline';
  /*
   * `measuredAt` and `fetchedAt` are left exactly as they were.
   *
   * Both are already true and neither changed by going offline: the first says
   * when the air was sampled, the second when the server retrieved it. Stamping
   * the download instant over `fetchedAt` would move it LATER and make the
   * payload look fresher than it is. The download instant travels in the header
   * below instead, where it cannot be mistaken for a retrieval from upstream.
   */

  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    [OFFLINE_HEADER]: '1',
  });
  if (cachedAt) headers.set(CACHED_AT_HEADER, cachedAt);

  return new Response(JSON.stringify(payload), { status: 200, headers });
}

function offlineFailure(detail) {
  return new Response(
    JSON.stringify({ error: { code: 'offline', message: detail } }),
    {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        [OFFLINE_HEADER]: '1',
      },
    },
  );
}

/* -------------------------------------------------------------------------- */
/*  Navigation                                                                */
/* -------------------------------------------------------------------------- */

async function handleNavigation(request) {
  const url = new URL(request.url);

  try {
    const response = await fetch(request);

    /*
     * Cached only when the URL has no query string.
     *
     * `/alerts?state=confirmed` is the outcome of following a one-time token and
     * must never be replayed, and query strings would otherwise multiply the
     * cache without bound.
     */
    if (response.ok && !url.search) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(
        request,
        withHeader(response.clone(), CACHED_AT_HEADER, new Date().toISOString()),
      );
    }

    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);

    const exact = await cache.match(request, { ignoreSearch: true });
    if (exact) return withHeader(exact, OFFLINE_HEADER, '1');

    const shell = await cache.match(SHELL_PATH);
    if (shell) return withHeader(shell, OFFLINE_HEADER, '1');

    /*
     * Last resort: the worker is installed but nothing has ever been cached.
     *
     * This markup cannot use the application's dictionary — the worker has no
     * access to it — so it is kept to one sentence in the shipping language and
     * carries no readings, no figures and no claim about air quality. It is only
     * reachable before the application has ever loaded successfully.
     */
    return new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>maqua.app — offline</title></head>' +
        '<body style="font-family:system-ui,sans-serif;margin:0;padding:2rem;line-height:1.5">' +
        '<h1 style="font-size:1.25rem">You appear to be offline</h1>' +
        '<p>No air-quality data has been downloaded on this device yet, so there is nothing to show. ' +
        'Reconnect and reload to see current readings.</p>' +
        '</body></html>',
      {
        status: 503,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          [OFFLINE_HEADER]: '1',
        },
      },
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Static assets                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Cache-first, because these URLs are content-hashed: the bytes behind a given
 * path never change, so a hit is always correct and a miss is always a genuinely
 * new asset.
 *
 * The `catch` matters more than it looks. Offline, a cached page still asks for
 * the script chunks it references, and a chunk the device never downloaded is a
 * miss. Letting that rejection escape `respondWith` produces an unhandled
 * failure rather than an ordinary network error — React would not hydrate, and
 * the offline banner is a client component, so the reader would be left looking
 * at cached readings with nothing on screen to say they are old. Returning a
 * network error instead makes a missing chunk fail exactly as it would with no
 * service worker installed at all.
 */
async function handleAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}
