/**
 * GET /api/cron/refresh-air-quality
 *
 * Fetches the current hour from upstream and archives it.
 *
 * Scheduled at five minutes past the hour: upstream publishes hourly with a
 * measured ~58-minute lag (docs/DATA_SOURCE.md §6), so `:05` is the first minute
 * at which the newest observed hour is reliably available. Running at `:00`
 * would race the publication and archive nothing new.
 */

import { isDatabaseConfigured } from '@/db/client';
import { finishImportRun, recordProviderProbe, startImportRun } from '@/db/queries/health';
import { storeStationReadings, syncStations } from '@/db/queries/readings';
import { getProvider } from '@/lib/air-quality/service';
import { cacheKeys } from '@/lib/cache/keys';
import { probeErrorMessage, runCronJob } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Five station documents plus the station list; comfortably inside a minute. */
export const maxDuration = 60;

export async function GET(request: Request) {
  return runCronJob(
    request,
    {
      job: 'refresh-air-quality',
      lockKey: cacheKeys.lockRefreshAirQuality(),
      lockTtlSeconds: 300,
    },
    async ({ now }) => {
      const provider = getProvider();
      const runId = await startImportRun('refresh-air-quality', provider.name, now);

      const fetchStartedAt = Date.now();
      let readings;

      try {
        /*
         * Deliberately the PROVIDER, not `getLatestReadings()`.
         *
         * The service caches readings for fifteen minutes, so the cached path
         * would hand this job back the same snapshot it archived last time and
         * report a successful run that persisted nothing new. Archiving is the
         * whole point of this route, so it always goes to source.
         *
         * It does not warm the read cache afterwards either: that would repeat
         * the entire fetch (one request per station) seconds later, and the read
         * path converges on its own within its TTL at a cost of one slower
         * request for one visitor.
         */
        readings = await provider.getLatestReadings();
      } catch (error) {
        const latencyMs = Date.now() - fetchStartedAt;
        await recordProviderProbe(
          { provider: provider.name, ok: false, latencyMs, error: probeErrorMessage(error) },
          now,
        );
        await finishImportRun(runId, { ok: false, error: probeErrorMessage(error) }, new Date());
        throw error;
      }

      const latencyMs = Date.now() - fetchStartedAt;
      const reporting = readings.filter((reading) => reading.overallCategory !== null).length;

      await recordProviderProbe(
        {
          provider: provider.name,
          ok: true,
          latencyMs,
          detail: { stations: readings.length, reporting },
        },
        now,
      );

      if (!isDatabaseConfigured()) {
        await finishImportRun(runId, { ok: true, rowsRead: readings.length }, new Date());
        return {
          skipped:
            'No database is configured, so upstream was verified but nothing was archived. The public API is unaffected.',
          detail: { stations: readings.length, reporting, latencyMs },
        };
      }

      // Readings carry a foreign key to `air_quality_stations`, so the station
      // rows must exist before the first reading of a deployment can be written.
      const stationRows = await syncStations(now);
      const ingest = await storeStationReadings(readings);

      await finishImportRun(
        runId,
        {
          ok: true,
          rowsRead: ingest.read,
          rowsWritten: ingest.written,
          rowsSkipped: ingest.skipped,
        },
        new Date(),
      );

      return {
        detail: {
          stations: readings.length,
          reporting,
          stationRows,
          // `skipped` counts hours already on record. Expected on every re-run —
          // ingestion is idempotent by unique constraint, not by luck.
          rowsRead: ingest.read,
          rowsWritten: ingest.written,
          rowsSkipped: ingest.skipped,
          latencyMs,
        },
      };
    },
  );
}
