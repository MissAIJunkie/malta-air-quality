import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { cacheKeys, cachePolicy } from '../keys';
import { cached, clearMemoryCache, withLock, type CacheOptions } from '../upstash';

/**
 * These tests run with no Upstash credentials, which is deliberate: the brief
 * requires the app to work with no Redis at all, so the in-process fallback is
 * the path that must be proven. No network call is made from this file.
 */

/** Fresh for a full minute — long enough that nothing expires mid-test. */
const FRESH: CacheOptions = { ttlSeconds: 60, staleWhileRevalidateSeconds: 60 };

/**
 * Expires immediately, but stays servable for a minute.
 *
 * `ttlSeconds: 0` makes `freshUntil === storedAt`, so the next call is always a
 * miss without needing fake timers — which would also have to fake the clock
 * inside the cache module itself.
 */
const IMMEDIATELY_STALE: CacheOptions = { ttlSeconds: 0, staleWhileRevalidateSeconds: 60 };

/** Expires immediately and may not be served stale at all. */
const NO_GRACE: CacheOptions = { ttlSeconds: 0, staleWhileRevalidateSeconds: 0 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  clearMemoryCache();
  // The cache logs a warning whenever it degrades. That is correct behaviour and
  // several tests provoke it on purpose, so the noise is suppressed rather than
  // left to clutter the run.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  clearMemoryCache();
});

describe('cached — fresh values', () => {
  it('calls upstream on a miss and reports the value as not cached', async () => {
    const fetcher = vi.fn(async () => ({ readings: 5 }));
    const result = await cached('test:fresh', FRESH, fetcher);

    expect(result.value).toEqual({ readings: 5 });
    expect(result.cached).toBe(false);
    expect(result.stale).toBe(false);
    expect(result.degradedReason).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serves the second caller from cache without touching upstream', async () => {
    // This is the mechanism the brief demands: the server decides how often the
    // EEA is polled, not the number of browsers watching.
    const fetcher = vi.fn(async () => 'upstream');

    await cached('test:reuse', FRESH, fetcher);
    const second = await cached('test:reuse', FRESH, fetcher);

    expect(second.value).toBe('upstream');
    expect(second.cached).toBe(true);
    expect(second.stale).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keys entries independently', async () => {
    await cached('test:a', FRESH, async () => 'A');
    await cached('test:b', FRESH, async () => 'B');

    expect((await cached('test:a', FRESH, async () => 'changed')).value).toBe('A');
    expect((await cached('test:b', FRESH, async () => 'changed')).value).toBe('B');
  });

  it('refetches once the freshness window has passed', async () => {
    const fetcher = vi.fn(async () => Math.random());

    await cached('test:expiry', IMMEDIATELY_STALE, fetcher);
    const second = await cached('test:expiry', IMMEDIATELY_STALE, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(second.cached).toBe(false);
    expect(second.stale).toBe(false);
  });
});

describe('cached — serving stale after an upstream failure', () => {
  it('returns last-known-good with a degradedReason instead of an error', async () => {
    // The map staying up with an honestly labelled old reading beats an error
    // page. `degradedReason` is what lets the UI say so.
    await cached('test:degrade', IMMEDIATELY_STALE, async () => 'last known good');

    const result = await cached('test:degrade', IMMEDIATELY_STALE, async () => {
      throw new Error('upstream 503');
    });

    expect(result.value).toBe('last known good');
    expect(result.cached).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.degradedReason).toBe('upstream_unavailable');
  });

  it('keeps serving the same stale value across repeated failures', async () => {
    await cached('test:degrade-twice', IMMEDIATELY_STALE, async () => 'good');

    const boom = async (): Promise<string> => {
      throw new Error('still down');
    };

    expect((await cached('test:degrade-twice', IMMEDIATELY_STALE, boom)).value).toBe('good');
    expect((await cached('test:degrade-twice', IMMEDIATELY_STALE, boom)).value).toBe('good');
  });

  it('logs the degradation rather than swallowing it silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await cached('test:degrade-log', IMMEDIATELY_STALE, async () => 'good');
    await cached('test:degrade-log', IMMEDIATELY_STALE, async () => {
      throw new Error('upstream 503');
    });

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('cache.serving_stale');
  });

  it('recovers to a fresh, non-degraded value once upstream returns', async () => {
    await cached('test:recover', IMMEDIATELY_STALE, async () => 'v1');
    await cached('test:recover', IMMEDIATELY_STALE, async () => {
      throw new Error('down');
    });

    const recovered = await cached('test:recover', IMMEDIATELY_STALE, async () => 'v2');
    expect(recovered.value).toBe('v2');
    expect(recovered.stale).toBe(false);
    expect(recovered.degradedReason).toBeUndefined();
  });
});

describe('cached — rethrowing when there is nothing to serve', () => {
  it('propagates the error on a cold miss', async () => {
    // With nothing cached there is no honest answer, so the caller must be told.
    // Inventing a placeholder here would put fabricated air quality on screen.
    await expect(
      cached('test:cold', FRESH, async () => {
        throw new Error('upstream 503');
      }),
    ).rejects.toThrow('upstream 503');
  });

  it('propagates once the stale-while-revalidate window has also expired', async () => {
    await cached('test:no-grace', NO_GRACE, async () => 'too old to serve');

    await expect(
      cached('test:no-grace', NO_GRACE, async () => {
        throw new Error('upstream 503');
      }),
    ).rejects.toThrow('upstream 503');
  });

  it('does not poison the key — a later success repopulates it', async () => {
    await expect(
      cached('test:retry', FRESH, async () => {
        throw new Error('down');
      }),
    ).rejects.toThrow('down');

    const result = await cached('test:retry', FRESH, async () => 'back up');
    expect(result.value).toBe('back up');
    expect(result.cached).toBe(false);
  });
});

describe('cached — single-flight', () => {
  it('collapses concurrent misses into one upstream call', async () => {
    // Without this, a cold cache plus a burst of traffic would stampede the EEA.
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    const inFlight = Promise.all([
      cached('test:single', FRESH, fetcher),
      cached('test:single', FRESH, fetcher),
      cached('test:single', FRESH, fetcher),
    ]);

    gate.resolve('one upstream response');
    const results = await inFlight;

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.value)).toEqual([
      'one upstream response',
      'one upstream response',
      'one upstream response',
    ]);
    // The first caller owns the fetch; the followers are told they were served
    // without an upstream call of their own.
    expect(results[0].cached).toBe(false);
    expect(results.slice(1).every((r) => r.cached)).toBe(true);
  });

  it('lets a follower fall back to its own attempt when the shared fetch fails', async () => {
    const gate = deferred<string>();
    let call = 0;
    const fetcher = vi.fn(() => {
      call += 1;
      return call === 1 ? gate.promise : Promise.resolve('second attempt');
    });

    const inFlight = Promise.all([
      cached('test:single-fail', FRESH, fetcher).catch((e: Error) => e.message),
      cached('test:single-fail', FRESH, fetcher).catch((e: Error) => e.message),
    ]);

    gate.reject(new Error('shared fetch failed'));
    const [first, second] = await inFlight;

    expect(first).toBe('shared fetch failed');
    // The follower is not condemned by someone else's failure; it retries.
    expect(second).toEqual(expect.objectContaining({ value: 'second attempt' }));
  });

  it('clears the in-flight entry so a later call is not stuck on a dead promise', async () => {
    await expect(
      cached('test:single-clear', FRESH, async () => {
        throw new Error('first');
      }),
    ).rejects.toThrow('first');

    await expect(cached('test:single-clear', FRESH, async () => 'later')).resolves.toEqual(
      expect.objectContaining({ value: 'later' }),
    );
  });
});

describe('withLock without Redis', () => {
  it('runs the work rather than refusing it', async () => {
    // Locking is an optimisation for multi-instance cron. With no lock store the
    // job must still run, otherwise a Redis-less deployment would never refresh.
    const fn = vi.fn(async () => 'done');
    await expect(withLock(cacheKeys.lockRefreshAirQuality(), 30, fn)).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('cache policy', () => {
  it('polls upstream less often than upstream publishes', () => {
    // Upstream republishes hourly with a ~58-minute lag, so a TTL under an hour
    // is enough to never miss an update, and 15 minutes caps us at ~4 requests
    // an hour no matter how many people are looking.
    expect(cachePolicy.latestReadings.ttlSeconds).toBeLessThanOrEqual(3600);
    expect(cachePolicy.latestReadings.ttlSeconds).toBeGreaterThan(0);
  });

  it('always allows a stale window, so an outage never blanks the map', () => {
    for (const policy of Object.values(cachePolicy)) {
      expect(policy.staleWhileRevalidateSeconds).toBeGreaterThan(policy.ttlSeconds);
    }
  });

  it('namespaces and versions every key', () => {
    const keys = [
      cacheKeys.latestReadings('EEA'),
      cacheKeys.stations('FIXTURE'),
      cacheKeys.stationHistory('EEA', 'MT00011', 'all:now:obs'),
      cacheKeys.forecast('MT00004'),
      cacheKeys.aiExplanation('abc123'),
      cacheKeys.rateLimit('explain', '203.0.113.1'),
    ];
    for (const key of keys) expect(key.startsWith('v1:')).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('separates providers, so fixture data can never be served as live data', () => {
    expect(cacheKeys.latestReadings('FIXTURE')).not.toBe(cacheKeys.latestReadings('EEA'));
  });
});
