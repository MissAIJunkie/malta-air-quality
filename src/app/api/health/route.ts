/**
 * GET /api/health
 *
 * What is working, what is degraded, and what is switched off.
 *
 * Three rules govern this route:
 *
 *   1. **It never throws.** Every subsystem is probed inside its own try/catch,
 *      so one failure degrades one field rather than collapsing the response.
 *      The status code is always 200 — a monitor needs to read the body to learn
 *      *what* is wrong, and a 500 here would tell it nothing.
 *   2. **It never exposes a secret.** No connection strings, no API keys, no
 *      model names, no prompts, no upstream URLs. Only capability booleans, a
 *      provider name that already appears in every API response, and counts.
 *   3. **Unconfigured is not unhealthy.** Running with no database, no Redis, no
 *      AI and no email is a supported deployment mode, so those subsystems
 *      report `disabled` and never drag the overall status down.
 */

import { NextResponse } from 'next/server';

import { PROVIDER_PROBE_NAMES } from '@/app/api/cron/shared';
import { getCapabilities, getEnv } from '@/config/env';
import { listRecentImportRuns, summariseProviderHealth } from '@/db/queries/health';
import { getLatestReadings, getProvider, summariseMalta } from '@/lib/air-quality/service';
import { RELEVANCE_THRESHOLD } from '@/lib/environmental-context/relevance';
import { getAtmosphericContext } from '@/lib/environmental-context/service';
import { logger } from '@/lib/monitoring/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SubsystemStatus = 'ok' | 'degraded' | 'unavailable' | 'disabled';

type OverallStatus = 'ok' | 'degraded' | 'unavailable';

/** The later of two instants, treating `null` as "no information". */
function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export async function GET() {
  const capabilities = getCapabilities();
  const env = getEnv();
  const provider = getProvider();
  const nowIso = new Date().toISOString();

  /* ---------------------------------------------------------------------- */
  /*  Air quality                                                            */
  /* ---------------------------------------------------------------------- */

  let airQualityStatus: SubsystemStatus = 'unavailable';
  let reportingStations = 0;
  let totalStations = 0;
  let staleStations = 0;
  let readingsFreshFetchAt: string | null = null;
  let readingsStale = false;
  let readingsPartial = false;

  try {
    const { readings, meta } = await getLatestReadings();
    const summary = summariseMalta(readings, nowIso);

    reportingStations = summary.reportingStations;
    totalStations = summary.totalStations;
    staleStations = summary.staleStations;
    readingsStale = meta.stale;
    readingsPartial = meta.partial;

    // `meta.fetchedAt` is when this response was assembled, which is "now" even
    // on a cache hit. It is evidence that upstream answered only when the value
    // did NOT come from the cache.
    readingsFreshFetchAt = meta.cached ? null : meta.fetchedAt;

    if (reportingStations === 0) {
      airQualityStatus = 'unavailable';
    } else if (meta.stale || meta.partial) {
      airQualityStatus = 'degraded';
    } else {
      airQualityStatus = 'ok';
    }
  } catch (error) {
    logger.error('health.air_quality_probe_failed', { error: String(error) });
    airQualityStatus = 'unavailable';
  }

  /* ---------------------------------------------------------------------- */
  /*  Environmental context and weather                                      */
  /* ---------------------------------------------------------------------- */

  let contextReachable = false;
  let weatherAvailable = false;
  let contextStale = true;
  let activeContextEvents = 0;
  let contextFreshFetchAt: string | null = null;

  try {
    const snapshot = await getAtmosphericContext(nowIso);
    contextReachable = true;
    weatherAvailable = snapshot.weather !== null;
    contextStale = snapshot.stale;
    contextFreshFetchAt = snapshot.cached ? null : snapshot.fetchedAt;
    // The same set `/api/context` would show, so the two cannot disagree.
    activeContextEvents = snapshot.events.filter(
      (event) => event.relevance >= RELEVANCE_THRESHOLD,
    ).length;
  } catch (error) {
    logger.error('health.context_probe_failed', { error: String(error) });
  }

  /* ---------------------------------------------------------------------- */
  /*  Recorded telemetry                                                     */
  /* ---------------------------------------------------------------------- */

  /*
   * The probe tables are the only durable record of when a source last actually
   * answered. Without a database they are empty, and `lastSuccessful*Fetch`
   * falls back to this request's own evidence — which exists only when the live
   * call went upstream rather than hitting the cache. A `null` therefore means
   * "not established", never "it has never worked": the per-provider `status`
   * field is what answers "is it working right now".
   */
  const airQualityProbe = await summariseProviderHealth(provider.name, 24, new Date()).catch(
    () => null,
  );
  const weatherProbe = await summariseProviderHealth(
    PROVIDER_PROBE_NAMES.weather,
    24,
    new Date(),
  ).catch(() => null);
  const contextProbe = await summariseProviderHealth(
    PROVIDER_PROBE_NAMES.context,
    24,
    new Date(),
  ).catch(() => null);

  const lastSuccessfulAirQualityFetch = laterOf(
    airQualityProbe?.lastOk && airQualityProbe.lastCheckedAt
      ? airQualityProbe.lastCheckedAt.toISOString()
      : null,
    readingsFreshFetchAt,
  );

  const lastSuccessfulContextFetch = laterOf(
    contextProbe?.lastOk && contextProbe.lastCheckedAt
      ? contextProbe.lastCheckedAt.toISOString()
      : null,
    contextFreshFetchAt,
  );

  /*
   * Database reachability cannot be probed here.
   *
   * Every query helper degrades a failure to a neutral value rather than
   * throwing (see `withDb`), so an empty result is indistinguishable from an
   * unreachable database. Reporting the last ingestion run is the honest signal:
   * a timestamp proves the database answered, and its absence means only that
   * nothing is on record.
   */
  const lastImportRun = capabilities.database
    ? await listRecentImportRuns('refresh-air-quality', 1)
        .then((runs) => runs[0] ?? null)
        .catch(() => null)
    : null;

  /* ---------------------------------------------------------------------- */
  /*  Overall status                                                         */
  /* ---------------------------------------------------------------------- */

  const weatherStatus: SubsystemStatus = !capabilities.weather
    ? 'disabled'
    : !contextReachable
      ? 'unavailable'
      : weatherAvailable
        ? 'ok'
        : 'degraded';

  let status: OverallStatus;
  if (airQualityStatus === 'unavailable') {
    status = 'unavailable';
  } else if (
    airQualityStatus === 'degraded' ||
    weatherStatus === 'unavailable' ||
    weatherStatus === 'degraded' ||
    (capabilities.weather && contextStale)
  ) {
    status = 'degraded';
  } else {
    status = 'ok';
  }

  return NextResponse.json(
    {
      status,

      airQualityProvider: {
        name: provider.name,
        status: airQualityStatus,
        stale: readingsStale,
        partial: readingsPartial,
        /** Denominator for `reportingStations`, which is meaningless alone. */
        stationsExpected: totalStations,
        /** `null` when nothing has been recorded — never 0, which would read as
         *  "0% uptime". */
        successRate: airQualityProbe?.successRate ?? null,
        samples: airQualityProbe?.samples ?? 0,
        lastCheckedAt: airQualityProbe?.lastCheckedAt?.toISOString() ?? null,
      },

      weatherProvider: {
        name: env.WEATHER_PROVIDER,
        configured: capabilities.weather,
        status: weatherStatus,
        successRate: weatherProbe?.successRate ?? null,
        samples: weatherProbe?.samples ?? 0,
        lastCheckedAt: weatherProbe?.lastCheckedAt?.toISOString() ?? null,
      },

      lastSuccessfulAirQualityFetch,
      lastSuccessfulContextFetch,

      reportingStations,
      staleStations,
      activeContextEvents,

      database: {
        configured: capabilities.database,
        status: (capabilities.database ? 'ok' : 'disabled') satisfies SubsystemStatus,
        lastImportRunAt: lastImportRun?.startedAt?.toISOString() ?? null,
        lastImportRunOk: lastImportRun?.ok ?? null,
      },

      cache: {
        configured: capabilities.redis,
        backend: capabilities.redis ? 'upstash-redis' : 'in-process',
        status: (capabilities.redis ? 'ok' : 'disabled') satisfies SubsystemStatus,
        /** Reachability is not tested: a Redis outage degrades to the in-process
         *  map rather than failing, so a probe here would prove nothing. */
        probed: false,
      },

      ai: {
        configured: capabilities.ai || capabilities.aiContextSummaries,
        status: (capabilities.ai || capabilities.aiContextSummaries
          ? 'ok'
          : 'disabled') satisfies SubsystemStatus,
        explanations: capabilities.ai,
        contextSummaries: capabilities.aiContextSummaries,
      },

      email: {
        configured: capabilities.email,
        status: (capabilities.email ? 'ok' : 'disabled') satisfies SubsystemStatus,
      },
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
