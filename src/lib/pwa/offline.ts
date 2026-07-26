/**
 * The contract between `public/sw.js` and the interface.
 *
 * The worker is served as a plain file and is not part of the module graph, so
 * it cannot import from here. These two header names are therefore duplicated in
 * that file, and the pair must stay in step — this module is the only thing that
 * reads them.
 */

/** ISO-8601 instant this device downloaded the cached copy. */
export const CACHED_AT_HEADER = 'x-maqua-cached-at';

/** Set by the worker on any response it served from cache while offline. */
export const OFFLINE_HEADER = 'x-maqua-offline';

export type OfflineReadingsInfo = {
  /** When this device downloaded the copy. `null` when it cannot be established. */
  downloadedAt: string | null;
  /**
   * The instant the readings themselves refer to. Unchanged by the worker: going
   * offline does not alter when something was measured.
   */
  measuredAt: string | null;
  /** True when the response came from the worker's cache rather than the network. */
  fromCache: boolean;
};

/**
 * Ask the service worker what it is holding.
 *
 * Called only when the browser already believes it is offline, so the request
 * never reaches the network: the worker answers from its store, or the fetch
 * fails and there is nothing to report.
 *
 * Returns `null` when nothing usable is available — which the caller must render
 * as "no readings have been downloaded", never as an absence of pollution.
 */
export async function readCachedReadings(
  signal?: AbortSignal,
): Promise<OfflineReadingsInfo | null> {
  if (typeof fetch !== 'function') return null;

  try {
    const response = await fetch('/api/air-quality', { signal, cache: 'no-store' });
    if (!response.ok) return null;

    const downloadedAt = response.headers.get(CACHED_AT_HEADER);
    const fromCache = response.headers.get(OFFLINE_HEADER) === '1';

    const payload: unknown = await response.json();
    const measuredAt = readMeasuredAt(payload);

    return { downloadedAt, measuredAt, fromCache };
  } catch {
    return null;
  }
}

function readMeasuredAt(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const meta = (payload as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object') return null;
  const measuredAt = (meta as { measuredAt?: unknown }).measuredAt;
  return typeof measuredAt === 'string' ? measuredAt : null;
}
