/**
 * Cache key registry.
 *
 * Keys are namespaced and versioned. Bumping a version invalidates a whole class
 * of entries after a shape change, which is safer than trying to migrate cached
 * values in place.
 */

const VERSION = 'v1';

export const cacheKeys = {
  latestReadings: (provider: string) => `${VERSION}:aq:latest:${provider}`,
  stations: (provider: string) => `${VERSION}:aq:stations:${provider}`,
  stationHistory: (provider: string, stationId: string, window: string) =>
    `${VERSION}:aq:history:${provider}:${stationId}:${window}`,
  weather: () => `${VERSION}:weather:current`,
  contextEvents: () => `${VERSION}:context:events`,
  forecast: (stationId: string) => `${VERSION}:forecast:${stationId}`,
  providerHealth: (provider: string) => `${VERSION}:health:${provider}`,

  /**
   * AI explanations are keyed by the DATA they describe, not by request.
   * Identical inputs must never trigger a second model call — that is the whole
   * cost-control story. Built by `lib/ai/cache.ts`.
   */
  aiExplanation: (hash: string) => `${VERSION}:ai:explain:${hash}`,

  /** Locks. */
  lockRefreshAirQuality: () => `${VERSION}:lock:refresh:air-quality`,
  lockRefreshContext: () => `${VERSION}:lock:refresh:context`,
  lockEvaluateAlerts: () => `${VERSION}:lock:alerts:evaluate`,

  /** Rate limiting. */
  rateLimit: (route: string, identifier: string) => `${VERSION}:rl:${route}:${identifier}`,
} as const;

/** Cache policies, in seconds. */
export const cachePolicy = {
  /**
   * Upstream republishes hourly with a ~58-minute lag, so polling more often
   * than every 15 minutes cannot surface new data. This caps upstream traffic at
   * roughly four requests an hour regardless of how many people are looking.
   */
  latestReadings: { ttlSeconds: 900, staleWhileRevalidateSeconds: 7200 },
  /** Station geometry effectively never changes. */
  stations: { ttlSeconds: 21_600, staleWhileRevalidateSeconds: 86_400 },
  stationHistory: { ttlSeconds: 1800, staleWhileRevalidateSeconds: 7200 },
  weather: { ttlSeconds: 1800, staleWhileRevalidateSeconds: 7200 },
  contextEvents: { ttlSeconds: 1800, staleWhileRevalidateSeconds: 10_800 },
  forecast: { ttlSeconds: 3600, staleWhileRevalidateSeconds: 10_800 },
} as const;
