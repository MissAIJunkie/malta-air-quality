/**
 * GET /api/cron/cleanup
 *
 * Applies the retention policy in `src/db/retention.ts`.
 *
 * Every window is defined there rather than here, so the published privacy
 * notice and the job that enforces it are generated from the same constants and
 * cannot drift apart. An indefinite policy yields a `null` cutoff, and a `null`
 * cutoff deletes nothing — the query helpers check that explicitly, because it
 * is the difference between "keep forever" and "delete everything".
 */

import { isDatabaseConfigured } from '@/db/client';
import { pruneOperationalLogs } from '@/db/queries/health';
import { pruneReadings } from '@/db/queries/readings';
import { pruneAlertData } from '@/db/queries/subscriptions';
import { CRON_LOCK_KEYS, runCronJob } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Retention keys this job does not yet enforce, reported in every response so
 * the gap is visible rather than assumed handled.
 *
 * `environmentalEvents` is absent on purpose: the policy is indefinite, and
 * events that stop being current are deactivated by `/api/cron/refresh-context`
 * rather than deleted, so a past episode stays explainable.
 */
const UNENFORCED_RETENTION = [
  // No query module exists for `ai_summaries`; writing the DELETE here would put
  // persistence in a route handler instead of `src/db/queries/*`.
  'aiSummaries',
  // Likewise `weather_observations`, which nothing writes to yet.
  'weatherObservations',
] as const;

export async function GET(request: Request) {
  return runCronJob(
    request,
    {
      job: 'cleanup',
      lockKey: CRON_LOCK_KEYS.cleanup,
      lockTtlSeconds: 600,
    },
    async ({ now }) => {
      if (!isDatabaseConfigured()) {
        return {
          skipped: 'No database is configured, so there is nothing to prune.',
        };
      }

      const readings = await pruneReadings(now);
      const alerts = await pruneAlertData(now);
      const operational = await pruneOperationalLogs(now);

      return {
        detail: {
          readingsDeleted: readings.readings,
          forecastsDeleted: readings.forecasts,
          alertDeliveriesDeleted: alerts.deliveries,
          unsubscribedSubscriptionsDeleted: alerts.unsubscribed,
          unconfirmedSubscriptionsDeleted: alerts.unconfirmed,
          providerProbesDeleted: operational.probes,
          importRunsDeleted: operational.importRuns,
          unenforcedRetention: UNENFORCED_RETENTION,
        },
      };
    },
  );
}
