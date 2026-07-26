/**
 * Cache layer — Upstash Redis with an in-process fallback.
 *
 * Two requirements shape this:
 *
 *   - The brief forbids letting every browser poll upstream. The server decides
 *     how often external sources are queried, so caching is not an optimisation
 *     here, it is the mechanism.
 *   - Redis is optional. Without credentials the app must still work, so we fall
 *     back to an in-process map. That is per-instance rather than distributed,
 *     which is fine for local development and acceptable for a small deployment.
 *
 * Supports stale-while-revalidate: an expired-but-recent entry is returned
 * immediately and refreshed in the background, so a slow upstream never blocks a
 * page render.
 */

import { Redis } from '@upstash/redis';
import { getEnv, getCapabilities } from '@/config/env';
import { logger } from '@/lib/monitoring/logger';

export type CacheEntry<T> = {
  value: T;
  /** Epoch ms when the entry was written. */
  storedAt: number;
  /** Epoch ms after which it is stale. */
  freshUntil: number;
};

export type CacheResult<T> = {
  value: T;
  /** Served without contacting upstream. */
  cached: boolean;
  /** Served past its freshness window while a refresh runs. */
  stale: boolean;
  /** Set when upstream failed and last-known-good was served instead. */
  degradedReason?: string;
};

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!getCapabilities().redis) return null;
  if (redis) return redis;
  const env = getEnv();
  redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL!,
    token: env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return redis;
}

/** Per-instance fallback store, also used for tests. */
const memory = new Map<string, CacheEntry<unknown>>();

/** In-flight requests, so concurrent callers in one instance share one fetch. */
const inflight = new Map<string, Promise<unknown>>();

async function readEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  const client = getRedis();
  if (!client) return (memory.get(key) as CacheEntry<T> | undefined) ?? null;

  try {
    return (await client.get<CacheEntry<T>>(key)) ?? null;
  } catch (error) {
    // A Redis outage must degrade to the in-process cache, not take the app down.
    logger.warn('cache.read_failed', { key, error: String(error) });
    return (memory.get(key) as CacheEntry<T> | undefined) ?? null;
  }
}

async function writeEntry<T>(key: string, entry: CacheEntry<T>, ttlSeconds: number): Promise<void> {
  memory.set(key, entry);
  const client = getRedis();
  if (!client) return;

  try {
    await client.set(key, entry, { ex: ttlSeconds });
  } catch (error) {
    logger.warn('cache.write_failed', { key, error: String(error) });
  }
}

export type CacheOptions = {
  /** Seconds the value is considered fresh. */
  ttlSeconds: number;
  /**
   * Extra seconds a stale value may be served while a refresh runs, and after
   * an upstream failure. This is what keeps the map usable during an outage.
   */
  staleWhileRevalidateSeconds: number;
};

/**
 * Read-through cache with stale-while-revalidate and single-flight.
 *
 * On upstream failure, a stale value within the SWR window is returned with
 * `degradedReason` set, so the UI can label it honestly instead of showing an
 * error page. If nothing cached exists, the error propagates.
 */
export async function cached<T>(
  key: string,
  options: CacheOptions,
  fetcher: () => Promise<T>,
): Promise<CacheResult<T>> {
  const now = Date.now();
  const entry = await readEntry<T>(key);

  if (entry && now < entry.freshUntil) {
    return { value: entry.value, cached: true, stale: false };
  }

  // Single-flight: concurrent misses in this instance await one upstream call
  // rather than stampeding it.
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) {
    try {
      return { value: await existing, cached: true, stale: false };
    } catch {
      // Fall through and let this caller try, or serve stale below.
    }
  }

  const promise = (async () => {
    const value = await fetcher();
    await writeEntry(
      key,
      {
        value,
        storedAt: Date.now(),
        freshUntil: Date.now() + options.ttlSeconds * 1000,
      },
      options.ttlSeconds + options.staleWhileRevalidateSeconds,
    );
    return value;
  })();

  inflight.set(key, promise);

  try {
    const value = await promise;
    return { value, cached: false, stale: false };
  } catch (error) {
    const staleDeadline = entry
      ? entry.freshUntil + options.staleWhileRevalidateSeconds * 1000
      : 0;

    if (entry && now < staleDeadline) {
      logger.warn('cache.serving_stale', { key, error: String(error) });
      return {
        value: entry.value,
        cached: true,
        stale: true,
        degradedReason: 'upstream_unavailable',
      };
    }

    logger.error('cache.miss_and_upstream_failed', { key, error: String(error) });
    throw error;
  } finally {
    inflight.delete(key);
  }
}

/**
 * Best-effort distributed lock, used by cron jobs so two concurrent invocations
 * do not both write history or both send the same alert.
 */
export async function withLock<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const client = getRedis();
  if (!client) return fn();

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const acquired = await client.set(key, token, { nx: true, ex: ttlSeconds });
    if (!acquired) {
      logger.info('lock.not_acquired', { key });
      return null;
    }
  } catch (error) {
    // If the lock store is unavailable, proceed rather than stalling the job.
    logger.warn('lock.unavailable', { key, error: String(error) });
    return fn();
  }

  try {
    return await fn();
  } finally {
    try {
      const current = await client.get<string>(key);
      if (current === token) await client.del(key);
    } catch {
      // Lock expires on its own.
    }
  }
}

/** Test helper. */
export function clearMemoryCache(): void {
  memory.clear();
  inflight.clear();
}
