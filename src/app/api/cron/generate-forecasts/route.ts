/**
 * GET /api/cron/generate-forecasts
 *
 * Archives the CAMS forecast hours the EEA publishes alongside each station's
 * observations, so a past forecast can later be compared with what was actually
 * measured.
 *
 * Nothing here predicts anything. maqua.app does not run a model — the values
 * are the official European forecast as disseminated by the EEA, and they are
 * written to a separate table from the readings so that no code path can turn a
 * forecast into an observation.
 */

import { STATIONS } from '@/config/stations';
import { isDatabaseConfigured } from '@/db/client';
import { finishImportRun, startImportRun } from '@/db/queries/health';
import { upsertForecasts, syncStations } from '@/db/queries/readings';
import type { NewAirQualityForecastRow } from '@/db/schema';
import { getStationForecastSeries } from '@/lib/forecast/providers/eea-cams-provider';
import { CRON_LOCK_KEYS, runCronJob } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  return runCronJob(
    request,
    {
      job: 'generate-forecasts',
      lockKey: CRON_LOCK_KEYS.generateForecasts,
      lockTtlSeconds: 300,
    },
    async ({ now }) => {
      const runId = await startImportRun('generate-forecasts', null, now);

      const rows: NewAirQualityForecastRow[] = [];
      const stationsWithoutAnchor: string[] = [];
      const stationsWithoutForecast: string[] = [];

      for (const station of STATIONS) {
        const { series } = await getStationForecastSeries(station.id);

        if (series.forecast.length === 0) {
          stationsWithoutForecast.push(station.id);
          continue;
        }

        /*
         * `basedOnObservationAt` is used as the model-run instant.
         *
         * The dissemination layer does not publish the CAMS run time, and the
         * unique key includes `issuedAt`, so the choice decides whether re-runs
         * are idempotent. The newest observation the series is anchored to is
         * stable for the whole publication hour, which makes a second run inside
         * that hour a no-op, and it genuinely identifies the vintage: a later
         * anchor means a later republication.
         *
         * When the station is silent there is no anchor, and a forecast anchored
         * to nothing could not be deduplicated at all — so it is skipped and
         * counted rather than stamped with a fabricated hour.
         */
        if (!series.basedOnObservationAt) {
          stationsWithoutAnchor.push(station.id);
          continue;
        }

        const issuedAt = new Date(series.basedOnObservationAt);

        for (const point of series.forecast) {
          const validAt = new Date(point.measuredAt);
          if (Number.isNaN(validAt.getTime())) continue;

          for (const reading of Object.values(point.pollutants)) {
            // A modelled hour with no value carries no information, and storing
            // it would put rows in the table that can only ever be rendered as
            // "unavailable". Gaps in the readings table are meaningful — a gap
            // in a forecast is not.
            if (!reading || reading.value === null) continue;

            rows.push({
              stationId: station.id,
              pollutant: reading.pollutant,
              validAt,
              issuedAt,
              value: reading.value,
              unit: reading.unit,
              subIndex: reading.subIndex,
              category: reading.category,
              // Set explicitly rather than taking the column default, so a
              // fixture run cannot write `model: 'CAMS'` beside `source: 'FIXTURE'`.
              model: series.source === 'FIXTURE' ? 'fixture' : 'CAMS',
              source: series.source,
            });
          }
        }
      }

      if (!isDatabaseConfigured()) {
        return {
          skipped:
            'No database is configured, so forecast points were read but not archived. /api/forecast is unaffected — it reads the live feed.',
          detail: {
            points: rows.length,
            stationsWithoutAnchor: stationsWithoutAnchor.length,
            stationsWithoutForecast: stationsWithoutForecast.length,
          },
        };
      }

      // Forecast rows carry the same foreign key as readings.
      await syncStations(now);
      const ingest = await upsertForecasts(rows);

      await finishImportRun(
        runId,
        {
          ok: true,
          rowsRead: ingest.read,
          rowsWritten: ingest.written,
          rowsSkipped: ingest.skipped,
          detail: {
            stationsWithoutAnchor: stationsWithoutAnchor.length,
            stationsWithoutForecast: stationsWithoutForecast.length,
          },
        },
        new Date(),
      );

      return {
        detail: {
          rowsRead: ingest.read,
          rowsWritten: ingest.written,
          // Points already on record for this vintage. Expected on a re-run.
          rowsSkipped: ingest.skipped,
          stationsWithoutAnchor: stationsWithoutAnchor.length,
          stationsWithoutForecast: stationsWithoutForecast.length,
        },
      };
    },
  );
}
