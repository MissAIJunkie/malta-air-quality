/**
 * Rate limiting.
 *
 * Two different jobs share this module, and conflating them would break one of
 * them:
 *
 *   - Abuse protection. A per-IP request budget on public endpoints. Exceeding
 *     it is a client problem and earns HTTP 429.
 *   - Spend protection. A deployment-wide budget on how often a model may be
 *     called, from `AI_MAX_REQUESTS_PER_MINUTE`. Exceeding it is OUR constraint,
 *     not the reader's, so the caller degrades to deterministic output and still
 *     answers with 200. A reader must never see an error because the project's
 *     AI budget for this minute is spent.
 *
 * Redis-backed when Upstash is configured, in-process otherwise. The in-process
 * limiter is per-instance and therefore approximate under horizontal scaling —
 * that is a deliberate trade: the brief requires the application to run with no
 * Redis at all, and an approximate limit is worth far more than none.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getCapabilities, getEnv } from '@/config/env';
import { getAiRequestsPerMinute } from '@/config/openrouter';
import { logger } from '@/lib/monitoring/logger';

export type RateLimitDecision = {
  /** False means the caller must not proceed. */
  success: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
  /** Value for a `Retry-After` header. Always at least 1. */
  retryAfterSeconds: number;
  backend: 'redis' | 'memory';
};

export type RateLimitRule = {
  limit: number;
  windowSeconds: number;
};

/**
 * Per-route budgets.
 *
 * `api/explain` is generous enough that a person clicking between five stations
 * and re-reading them never notices it, and tight enough that a script cannot
 * walk the endpoint. The AI budget is separate and comes from the environment,
 * because it is a cost ceiling rather than an abuse ceiling.
 */
const STATIC_RULES: Record<string, RateLimitRule> = {
  'api/explain': { limit: 20, windowSeconds: 60 },
  'api/subscribe': { limit: 5, windowSeconds: 300 },
  default: { limit: 60, windowSeconds: 60 },
};

/** Routes whose budget is resolved from configuration at call time. */
const DYNAMIC_RULES: Record<string, () => RateLimitRule> = {
  'ai/explain': () => ({ limit: getAiRequestsPerMinute(), windowSeconds: 60 }),
};

export function rateLimitRule(route: string): RateLimitRule {
  const dynamic = DYNAMIC_RULES[route];
  if (dynamic) return dynamic();
  return STATIC_RULES[route] ?? STATIC_RULES.default;
}

/* -------------------------------------------------------------------------- */
/*  Identifiers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * FNV-1a. Used to keep raw IP addresses out of Redis keys and logs.
 *
 * Deliberately not presented as anonymisation: the IPv4 space is small enough
 * that any hash of it can be brute-forced, and claiming otherwise would be
 * worse than doing nothing. It is key hygiene — the store holds an opaque token
 * with a short TTL instead of a plain address — and it is synchronous, which
 * keeps this module usable from every runtime.
 */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Derive a stable, pseudonymous identifier for the caller.
 *
 * Platform-set headers are preferred over `x-forwarded-for`. XFF is a list a
 * client may prepend to, and whether that is a problem depends on whether the
 * edge overwrites the header or appends to it — a property of the deployment,
 * not something this code can verify. Single-valued headers set by the platform
 * itself cannot be forged that way, so they are consulted first and XFF is the
 * last resort rather than the first choice.
 *
 * When no address is available at all, every anonymous caller shares one bucket:
 * that fails towards limiting rather than towards letting traffic through.
 */
export function identifierFromHeaders(headers: Headers): string {
  const candidate =
    headers.get('x-vercel-forwarded-for')?.trim() ||
    headers.get('cf-connecting-ip')?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim();

  if (!candidate) return 'anon';
  return `ip_${fnv1a(candidate)}`;
}

/* -------------------------------------------------------------------------- */
/*  In-process limiter                                                        */
/* -------------------------------------------------------------------------- */

/** key → request timestamps (epoch ms) inside the current window. */
const memoryHits = new Map<string, number[]>();

/** Bound the map so a scan of many identifiers cannot grow it without limit. */
const MEMORY_KEY_CEILING = 10_000;

function sweepMemory(now: number, windowMs: number): void {
  if (memoryHits.size <= MEMORY_KEY_CEILING) return;
  for (const [key, hits] of memoryHits) {
    const live = hits.filter((t) => now - t < windowMs);
    if (live.length === 0) memoryHits.delete(key);
    else memoryHits.set(key, live);
  }
}

function memoryLimit(key: string, rule: RateLimitRule): RateLimitDecision {
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;

  sweepMemory(now, windowMs);

  const hits = (memoryHits.get(key) ?? []).filter((t) => now - t < windowMs);
  const success = hits.length < rule.limit;
  if (success) hits.push(now);
  memoryHits.set(key, hits);

  const oldest = hits[0] ?? now;
  const resetAt = oldest + windowMs;

  return {
    success,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - hits.length),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    backend: 'memory',
  };
}

/* -------------------------------------------------------------------------- */
/*  Redis limiter                                                             */
/* -------------------------------------------------------------------------- */

let redis: Redis | null = null;
const limiters = new Map<string, Ratelimit>();
/**
 * Shared across limiters so an identifier already known to be blocked is
 * rejected without a round trip. Module-level, as the library requires.
 */
const ephemeralCache = new Map<string, number>();

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

function getLimiter(route: string, rule: RateLimitRule): Ratelimit | null {
  const client = getRedis();
  if (!client) return null;

  // Keyed by the rule as well as the route: a configuration change must produce
  // a new limiter rather than silently keeping the old budget for the process
  // lifetime.
  const cacheKey = `${route}:${rule.limit}:${rule.windowSeconds}`;
  const existing = limiters.get(cacheKey);
  if (existing) return existing;

  const limiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(rule.limit, `${rule.windowSeconds} s`),
    prefix: `maqua:rl:${route}`,
    ephemeralCache,
    // A slow rate-limit store must not become the slowest part of a page. After
    // this the library allows the request through; availability of public
    // information beats perfect enforcement of an abuse budget.
    timeout: 1_500,
    analytics: false,
  });

  limiters.set(cacheKey, limiter);
  return limiter;
}

/* -------------------------------------------------------------------------- */
/*  Entry point                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Consume one unit of the route's budget for this identifier.
 *
 * Never throws. A rate limiter that can fail the request it is protecting has
 * inverted its own purpose, so a Redis outage degrades to the in-process
 * limiter rather than propagating.
 */
export async function rateLimit(route: string, identifier: string): Promise<RateLimitDecision> {
  const rule = rateLimitRule(route);
  const key = `${route}:${identifier}`;
  const limiter = getLimiter(route, rule);

  if (!limiter) return memoryLimit(key, rule);

  try {
    const result = await limiter.limit(identifier);
    return {
      success: result.success,
      limit: result.limit,
      remaining: Math.max(0, result.remaining),
      resetAt: result.reset,
      retryAfterSeconds: Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
      backend: 'redis',
    };
  } catch (error) {
    logger.warn('ratelimit.redis_failed', { route, error: String(error) });
    return memoryLimit(key, rule);
  }
}

/** Test helper. */
export function clearRateLimitState(): void {
  memoryHits.clear();
  limiters.clear();
  ephemeralCache.clear();
  redis = null;
}
