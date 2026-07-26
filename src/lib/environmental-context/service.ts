/**
 * Environmental-context service — the single entry point for context.
 *
 * Orchestrates the whole pipeline: fetch → validate → normalise → classify →
 * score → deduplicate → cache. Route handlers and the forecast module consume
 * this and never reach a provider directly.
 *
 * Two behaviours are load-bearing:
 *
 *   1. **Failure yields silence, never fiction.** A provider that errors or
 *      times out contributes nothing and is named in `unavailableSources`. The
 *      cache helper rethrows when there is no last-known-good value, so each
 *      provider is wrapped individually — the result is an empty list, not a
 *      500 and never an invented event.
 *   2. **Context is advisory.** Nothing returned here modifies a measured
 *      concentration, a sub-index, or a category. It sits beside the data.
 */

import 'server-only';

import { getCapabilities, getEnv } from '@/config/env';
import { cached } from '@/lib/cache/upstash';
import { cacheKeys, cachePolicy } from '@/lib/cache/keys';
import { logger } from '@/lib/monitoring/logger';
import { CAMS_AEROSOL_SOURCE, OPEN_METEO_WEATHER_SOURCE } from './classify-event';
import { deduplicateEvents } from './deduplicate';
import { camsDustProvider } from './providers/cams-dust-provider';
import { fixtureContextProvider, FIXTURE_SOURCE } from './providers/fixture-provider';
import { openMeteoWeatherProvider } from './providers/open-meteo-provider';
import { RELEVANCE_THRESHOLD, rankByRelevance, withRelevance } from './relevance';
import type {
  AerosolContext,
  AtmosphericContext,
  ContextQuery,
  ContextResponseMeta,
  EnrichedContextEvent,
  SourceRef,
  WeatherContext,
} from './types';

/**
 * The context snapshot as stored in the cache.
 *
 * `fetchedAt` is deliberately absent: it would be frozen at write time and then
 * misreport the age of a cached entry. Callers stamp their own retrieval time,
 * matching how `air-quality/service.ts` handles the same problem.
 */
type CachedContext = {
  weather: WeatherContext | null;
  aerosol: AerosolContext | null;
  events: EnrichedContextEvent[];
  unavailableSources: string[];
};

export type AtmosphericContextResult = AtmosphericContext & {
  fetchedAt: string;
  cached: boolean;
  stale: boolean;
  degradedReason?: string;
};

const EMPTY_CONTEXT: CachedContext = {
  weather: null,
  aerosol: null,
  events: [],
  unavailableSources: [],
};

/**
 * Run a provider, converting failure into absence.
 *
 * Anything that reaches here — a timeout, a schema change, a blocked host — is
 * logged and swallowed. One provider must never be able to empty the other.
 */
async function attempt<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    logger.warn('context.provider_unavailable', { provider: label, error: String(error) });
    return null;
  }
}

/**
 * Build a fresh snapshot from whichever providers respond.
 *
 * Both upstream calls run concurrently: they are independent, and running them
 * in sequence would put two network round trips in the critical path of one
 * request.
 */
async function buildContext(nowIso: string): Promise<CachedContext> {
  const provider = getEnv().WEATHER_PROVIDER;

  if (provider === 'none' || !getCapabilities().weather) {
    // Explicitly disabled. Not an error, and not a reason to guess.
    return { ...EMPTY_CONTEXT, unavailableSources: ['weather-disabled'] };
  }

  if (provider === 'fixture') {
    const weather = await fixtureContextProvider.fetchWeather();
    const aerosol = await fixtureContextProvider.fetchAerosol();
    return {
      weather,
      aerosol,
      events: fixtureContextProvider.buildEvents(nowIso),
      unavailableSources: [],
    };
  }

  const [weather, aerosol] = await Promise.all([
    attempt('open-meteo-weather', () => openMeteoWeatherProvider.fetchContext()),
    attempt('cams-aerosol', () => camsDustProvider.fetchContext()),
  ]);

  const unavailableSources: string[] = [];
  if (!weather) unavailableSources.push(OPEN_METEO_WEATHER_SOURCE.name);
  if (!aerosol) unavailableSources.push(CAMS_AEROSOL_SOURCE.name);

  const events: EnrichedContextEvent[] = [
    ...(weather ? openMeteoWeatherProvider.deriveEvents(weather, nowIso) : []),
    ...(aerosol ? camsDustProvider.deriveEvents(aerosol, nowIso) : []),
  ];

  return { weather, aerosol, events, unavailableSources };
}

/**
 * The cached atmospheric snapshot.
 *
 * Only provider output is cached — the raw series and the classifier's events.
 * Scoring, ranking and filtering are re-run per request because relevance
 * depends on `now`, and a half-hour-old ranking would promote an event that has
 * since ended.
 */
export async function getAtmosphericContext(
  nowIso: string = new Date().toISOString(),
): Promise<AtmosphericContextResult> {
  const fetchedAt = new Date().toISOString();

  let result: { value: CachedContext; cached: boolean; stale: boolean; degradedReason?: string };

  try {
    result = await cached(cacheKeys.contextEvents(), cachePolicy.contextEvents, () =>
      buildContext(nowIso),
    );
  } catch (error) {
    // `cached` only throws when the fetcher failed AND nothing usable was
    // stored. `buildContext` already absorbs provider failures, so reaching
    // here means something more fundamental broke — degrade to empty rather
    // than failing the page that embeds this.
    logger.error('context.unavailable', { error: String(error) });
    result = {
      value: EMPTY_CONTEXT,
      cached: false,
      stale: true,
      degradedReason: 'context_unavailable',
    };
  }

  const snapshot = result.value;
  const scored = rankByRelevance(withRelevance(snapshot.events, nowIso));

  return {
    fetchedAt,
    weather: snapshot.weather,
    aerosol: snapshot.aerosol,
    // Deduplicate AFTER ranking so the surviving copy of a merged pair is the
    // more relevant one, and its citations absorb the other's.
    events: deduplicateEvents(scored),
    unavailableSources: snapshot.unavailableSources,
    cached: result.cached,
    stale: result.stale,
    ...(result.degradedReason ? { degradedReason: result.degradedReason } : {}),
  };
}

export type ContextEventsResult = {
  events: EnrichedContextEvent[];
  /** Model hours the underlying forecasts span. `null` when nothing was fetched. */
  coverage: { from: string; to: string } | null;
  meta: ContextResponseMeta;
};

/** Default cap on how many events a caller receives. */
export const DEFAULT_CONTEXT_LIMIT = 20;

function sourcesFor(snapshot: AtmosphericContextResult): SourceRef[] {
  if (getEnv().WEATHER_PROVIDER === 'fixture') return [FIXTURE_SOURCE];

  const sources: SourceRef[] = [];
  if (snapshot.weather) sources.push(snapshot.weather.source);
  if (snapshot.aerosol) sources.push(snapshot.aerosol.source);
  return sources;
}

function sourceLabel(sources: SourceRef[]): string {
  if (sources.length === 0) return 'unavailable';
  return sources.map((source) => source.name).join(' + ');
}

/**
 * Span of model hours the snapshot covers.
 *
 * Exposed in `data`, not as `meta.measuredAt`. Both providers publish hours
 * *ahead* of now, so putting the newest one in `measuredAt` would give any
 * consumer computing `now - measuredAt` a negative age and a "fresh in the
 * future" reading. `measuredAt` stays null because nothing here is a
 * measurement; `fetchedAt` is what describes this snapshot's freshness.
 */
export function modelCoverage(
  snapshot: AtmosphericContextResult,
): { from: string; to: string } | null {
  const times = [
    ...(snapshot.weather?.hours ?? []).map((hour) => hour.time),
    ...(snapshot.aerosol?.hours ?? []).map((hour) => hour.time),
  ].filter((time) => Number.isFinite(Date.parse(time)));

  if (times.length === 0) return null;

  return {
    from: times.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a)),
    to: times.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)),
  };
}

/**
 * Relevant, deduplicated context events, filtered and capped.
 *
 * Filters narrow an already-ranked list; they never change scores, so
 * `?type=saharan_dust` returns the same event, in the same order, that the
 * unfiltered list would have shown.
 */
export async function getContextEvents(query: ContextQuery = {}): Promise<ContextEventsResult> {
  const nowIso = new Date().toISOString();
  const snapshot = await getAtmosphericContext(nowIso);

  let events = snapshot.events.filter((event) => event.relevance >= RELEVANCE_THRESHOLD);

  if (query.types && query.types.length > 0) {
    const wanted = new Set(query.types);
    events = events.filter((event) => wanted.has(event.type));
  }

  if (query.impact) {
    events = events.filter((event) => event.impactDirection === query.impact);
  }

  const limit = query.limit ?? DEFAULT_CONTEXT_LIMIT;
  const limited = events.slice(0, limit);

  const sources = sourcesFor(snapshot);

  return {
    events: limited,
    coverage: modelCoverage(snapshot),
    meta: {
      source: sourceLabel(sources),
      // Null by design — see `modelCoverage`. Context is model output, not
      // measurement, and claiming a measurement instant would be wrong twice
      // over: wrong in kind, and wrong in sign.
      measuredAt: null,
      fetchedAt: snapshot.fetchedAt,
      // Both upstreams refresh hourly; the next useful poll is one cache
      // lifetime away rather than one model cycle.
      nextExpectedUpdateAt: new Date(
        Date.parse(snapshot.fetchedAt) + cachePolicy.contextEvents.ttlSeconds * 1000,
      ).toISOString(),
      stale: snapshot.stale,
      partial: snapshot.unavailableSources.length > 0,
      cached: snapshot.cached,
      ...(snapshot.degradedReason ? { degradedReason: snapshot.degradedReason } : {}),
      sources,
    },
  };
}

/**
 * Weather and aerosol series for the forecast module.
 *
 * Shares the cached snapshot, so opening the forecast page does not trigger a
 * second pair of upstream requests.
 */
export async function getContextForForecast(nowIso: string): Promise<{
  weather: WeatherContext | null;
  aerosol: AerosolContext | null;
  events: EnrichedContextEvent[];
}> {
  const snapshot = await getAtmosphericContext(nowIso);
  return {
    weather: snapshot.weather,
    aerosol: snapshot.aerosol,
    events: snapshot.events.filter((event) => event.relevance >= RELEVANCE_THRESHOLD),
  };
}
