/**
 * GET /api/cron/refresh-weather
 *
 * Keeps the meteorological half of the environmental-context snapshot warm and
 * records whether the weather source is reachable.
 *
 * ## Why this shares a lock with refresh-context
 *
 * Weather, aerosol and the derived events are ONE cached snapshot
 * (`cacheKeys.contextEvents()`), because they come from the same pipeline and
 * the forecast module needs them together. Two jobs refreshing one snapshot must
 * not run concurrently, so they contend on `lockRefreshContext`.
 *
 * The schedule in `vercel.json` runs this job at `:10` and `:40` and the context
 * job at `:25` and `:55`. The snapshot's TTL is thirty minutes, so these two
 * runs are what actually refetch it, and the context runs fifteen minutes later
 * archive whatever the fresh snapshot holds.
 *
 * A run that lands while the entry is still fresh refetches nothing and reports
 * `servedFromCache: true`. That is the honest outcome, not a failure — the cache
 * helper offers no forced-refresh path, and adding one would defeat the point of
 * capping upstream traffic.
 *
 * ## What this job does not do
 *
 * It does not archive hourly weather into `weather_observations`. No query
 * module exists for that table yet (`src/db/queries/` has readings, events,
 * subscriptions and health only), and writing SQL directly from a route handler
 * would put persistence in the wrong layer. Until that module lands, weather is
 * cached context rather than an archived series.
 */

import { getCapabilities } from '@/config/env';
import { recordProviderProbe } from '@/db/queries/health';
import { getAtmosphericContext } from '@/lib/environmental-context/service';
import { cacheKeys } from '@/lib/cache/keys';
import { PROVIDER_PROBE_NAMES, probeErrorMessage, runCronJob } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Probe name for the weather source, so `/api/health` can report its trend. */
const WEATHER_PROBE_NAME = PROVIDER_PROBE_NAMES.weather;

export async function GET(request: Request) {
  return runCronJob(
    request,
    {
      job: 'refresh-weather',
      lockKey: cacheKeys.lockRefreshContext(),
      lockTtlSeconds: 180,
    },
    async ({ now }) => {
      if (!getCapabilities().weather) {
        return { skipped: 'WEATHER_PROVIDER is "none" — no weather source is configured.' };
      }

      const startedAt = Date.now();
      let snapshot;

      try {
        snapshot = await getAtmosphericContext(now.toISOString());
      } catch (error) {
        await recordProviderProbe(
          {
            provider: WEATHER_PROBE_NAME,
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: probeErrorMessage(error),
          },
          now,
        );
        throw error;
      }

      const latencyMs = Date.now() - startedAt;
      const hours = snapshot.weather?.hours.length ?? 0;

      // "OK" means the provider produced a usable series. A snapshot served from
      // cache still counts: it proves the source answered recently, which is
      // exactly what the health trend is asking about.
      const ok = snapshot.weather !== null;

      await recordProviderProbe(
        {
          provider: WEATHER_PROBE_NAME,
          ok,
          latencyMs,
          error: ok ? null : 'No weather series was returned.',
          detail: {
            hours,
            cached: snapshot.cached,
            stale: snapshot.stale,
            unavailableSources: snapshot.unavailableSources.length,
          },
        },
        now,
      );

      return {
        detail: {
          weatherHours: hours,
          aerosolHours: snapshot.aerosol?.hours.length ?? 0,
          // True when the snapshot was already fresh, so nothing was refetched.
          servedFromCache: snapshot.cached,
          stale: snapshot.stale,
          unavailableSources: snapshot.unavailableSources.length,
          latencyMs,
        },
      };
    },
  );
}
