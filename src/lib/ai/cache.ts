/**
 * Explanation cache.
 *
 * The cost story of this feature is one line: identical inputs must never
 * trigger a second model call. Upstream publishes hourly, so a station's
 * reading is unchanged for roughly an hour; without a cache, a hundred readers
 * looking at Msida in that hour would buy a hundred identical paragraphs.
 *
 * The key is derived from the DATA, never from the request. Same station, same
 * measured hour, same rounded values, same events, same locale, same model, same
 * prompt version means the same key — regardless of who asked, from where, or
 * how often. Every one of those components must be present: dropping the model
 * or the prompt version would serve output generated under a different contract
 * as though it were current, which is the kind of bug nobody notices for months.
 *
 * Values are rounded to whole µg/m³ before hashing. That matches how the
 * European AQI itself classifies a concentration, so two values that round the
 * same are, for explanation purposes, the same reading.
 */

import 'server-only';

import { createHash } from 'node:crypto';
import { getExplanationCacheTtlSeconds } from '@/config/openrouter';
import { cacheKeys } from '@/lib/cache/keys';
import { cached } from '@/lib/cache/upstash';
import type { AirQualityExplanation } from './schemas';
import type { ExplainInput } from './redact';

export type GeneratedExplanation = {
  explanation: AirQualityExplanation;
  /** Model that actually produced it, which may be the configured fallback. */
  model: string;
};

export type CachedExplanationResult = GeneratedExplanation & {
  /** Served without a model call. */
  cached: boolean;
  /** Served past its freshness window after a generation failure. */
  stale: boolean;
};

/**
 * Stable fingerprint of everything that could change the output.
 *
 * Arrays are sorted before hashing so that a provider reordering its pollutants
 * does not manufacture a cache miss — and with it a needless model call.
 */
export function explanationFingerprint(input: ExplainInput, model: string): string {
  const pollutants = input.pollutants
    .map((p) => `${p.code}:${Math.round(p.value)}:${p.estimated ? 'e' : 'm'}`)
    .sort();

  const unavailable = input.unavailablePollutants.map((p) => p.code).sort();
  const events = input.events.map((e) => e.sourceId).sort();

  const material = JSON.stringify({
    station: input.station.id,
    measuredAt: input.reading.measuredAt,
    category: input.reading.overallCategory,
    dominant: input.reading.dominantPollutant,
    pollutants,
    unavailable,
    events,
    locale: input.locale,
    model,
    promptVersion: input.promptVersion,
  });

  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

export function explanationCacheKey(input: ExplainInput, model: string): string {
  return cacheKeys.aiExplanation(explanationFingerprint(input, model));
}

/**
 * Return the cached explanation, or generate and store one.
 *
 * `generate` MUST throw on failure or on output the validator rejects. A
 * fetcher that returned the deterministic fallback instead would write it into
 * the cache, and every later request for that hour would get the fallback even
 * after the model recovered — a transient fault frozen into place for the whole
 * TTL. The caller catches the throw and builds the fallback outside the cache.
 *
 * Stale-while-revalidate is set to the full TTL: if generation fails and a
 * previous explanation for this exact key exists, serving it is safe because the
 * key pins the underlying measurements. It describes the same reading.
 */
export async function getOrCreateExplanation(
  input: ExplainInput,
  model: string,
  generate: () => Promise<GeneratedExplanation>,
): Promise<CachedExplanationResult> {
  const ttlSeconds = getExplanationCacheTtlSeconds();

  const result = await cached<GeneratedExplanation>(
    explanationCacheKey(input, model),
    { ttlSeconds, staleWhileRevalidateSeconds: ttlSeconds },
    generate,
  );

  return {
    explanation: result.value.explanation,
    model: result.value.model,
    cached: result.cached,
    stale: result.stale,
  };
}
