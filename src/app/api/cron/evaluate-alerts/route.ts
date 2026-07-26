/**
 * GET /api/cron/evaluate-alerts
 *
 * Decides which subscribers should hear about the current hour, and sends.
 *
 * The decision itself lives in `lib/notifications/evaluate-alerts.ts`, which is
 * pure: subscriptions and readings in, decisions out. This route is the impure
 * half — it reads the database, claims each delivery, sends the mail and records
 * what happened. Keeping the split means "would this have alerted?" is a unit
 * test rather than a question you answer by watching an inbox.
 *
 * Order is load-bearing: a delivery slot is CLAIMED BEFORE the message is sent.
 * The unique index on `(subscription_id, signature)` is the real guard against a
 * duplicate send, so two overlapping invocations both insert, exactly one wins,
 * and the loser sends nothing.
 *
 * ## Why it runs twice an hour
 *
 * Upstream publishes hourly, so a second run cannot find a second hour — which
 * is exactly what makes it safe. It exists for the hour that publishes late: the
 * `:20` run would see the previous hour, and without the `:50` run the next
 * chance to notice an elevated hour would be sixty minutes away. A repeat run
 * over unchanged data sends nothing, because the delivery signature includes the
 * measurement instant and the unique index rejects it.
 */

import { buildEmailLinks } from '@/app/api/alerts/shared';
import { findStation, STATIONS } from '@/config/stations';
import { categoryRank, isElevatedCategory, type AirQualityCategory } from '@/config/thresholds';
import type { PollutantCode } from '@/config/pollutants';
import { isDatabaseConfigured } from '@/db/client';
import { getReadingsInWindow } from '@/db/queries/readings';
import {
  claimDelivery,
  completeDelivery,
  listDeliveredSignatures,
  listDueSubscriptions,
  normaliseEmail,
  recordSubscriptionAlertState,
} from '@/db/queries/subscriptions';
import type { AlertSubscriptionRow } from '@/db/schema';
import { getLatestReadings } from '@/lib/air-quality/service';
import { cacheKeys } from '@/lib/cache/keys';
import {
  evaluateAlerts,
  isWeeklySummaryDue,
  weeklyPeriodStart,
  weeklySummarySignature,
  type AlertSubscriptionState,
} from '@/lib/notifications/evaluate-alerts';
import { isEmailConfigured, sendEmail } from '@/lib/notifications/resend-client';
import {
  airQualityAlertEmail,
  improvementNoticeEmail,
  weeklySummaryEmail,
  type EmailContent,
  type WeeklyStationSummary,
} from '@/lib/notifications/templates';
import { createUnsubscribeToken } from '@/lib/notifications/tokens';
import { logger } from '@/lib/monitoring/logger';
import { runCronJob } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Hours in the weekly digest window, used to report data completeness. */
const WEEKLY_EXPECTED_HOURS = 7 * 24;

function toState(row: AlertSubscriptionRow): AlertSubscriptionState {
  return {
    id: row.id,
    email: row.email,
    locale: row.locale,
    alertTypes: row.alertTypes,
    stationId: row.stationId,
    pollutant: row.pollutant,
    thresholdCategory: row.thresholdCategory,
    minHoursBetweenAlerts: row.minHoursBetweenAlerts,
    verified: row.verified,
    paused: row.paused,
    unsubscribedAt: row.unsubscribedAt,
    lastAlertAt: row.lastAlertAt,
    lastAlertSignature: row.lastAlertSignature,
  };
}

type WeeklyAggregate = {
  worstCategory: AirQualityCategory | null;
  worstPollutant: PollutantCode | null;
  worstRank: number;
  /** Distinct hours in a Poor or worse band. */
  elevatedHours: Set<string>;
  /** Distinct hours with at least one usable value. */
  observedHours: Set<string>;
};

/**
 * Fold a week of stored rows into one summary per station.
 *
 * Coverage is counted alongside the worst band on purpose: "no elevated hours"
 * from a station that reported a third of the week means something quite
 * different from the same figure at full coverage, and only one of those is good
 * news.
 */
function summariseWeek(
  rows: Awaited<ReturnType<typeof getReadingsInWindow>>,
): Map<string, WeeklyAggregate> {
  const byStation = new Map<string, WeeklyAggregate>();

  for (const row of rows) {
    let aggregate = byStation.get(row.stationId);
    if (!aggregate) {
      aggregate = {
        worstCategory: null,
        worstPollutant: null,
        worstRank: -1,
        elevatedHours: new Set<string>(),
        observedHours: new Set<string>(),
      };
      byStation.set(row.stationId, aggregate);
    }

    const hour = row.measuredAt.toISOString();
    // A null value is a recorded absence, not a reading — it must not count
    // towards coverage.
    if (row.value !== null) aggregate.observedHours.add(hour);

    if (!row.category) continue;

    const rank = categoryRank(row.category);
    if (rank > aggregate.worstRank) {
      aggregate.worstRank = rank;
      aggregate.worstCategory = row.category;
      aggregate.worstPollutant = row.pollutant;
    }
    if (isElevatedCategory(row.category)) aggregate.elevatedHours.add(hour);
  }

  return byStation;
}

function weeklyStationSummaries(
  byStation: Map<string, WeeklyAggregate>,
  stationFilter: string | null,
): WeeklyStationSummary[] {
  return STATIONS.filter((station) => !stationFilter || station.id === stationFilter).map(
    (station) => {
      const aggregate = byStation.get(station.id);
      return {
        stationName: station.name,
        areaName: station.locality,
        // `null` where the station reported nothing. Rendered as "no data" by the
        // template — never as "Good".
        worstCategory: aggregate?.worstCategory ?? null,
        worstPollutant: aggregate?.worstPollutant ?? null,
        elevatedHours: aggregate?.elevatedHours.size ?? 0,
        observedHours: aggregate?.observedHours.size ?? 0,
        expectedHours: WEEKLY_EXPECTED_HOURS,
      };
    },
  );
}

export async function GET(request: Request) {
  return runCronJob(
    request,
    {
      job: 'evaluate-alerts',
      lockKey: cacheKeys.lockEvaluateAlerts(),
      lockTtlSeconds: 300,
    },
    async ({ now }) => {
      if (!isDatabaseConfigured()) {
        // Without a database `claimDelivery` returns null, so nothing could be
        // deduplicated — and an alert system that cannot deduplicate would send
        // the same warning every time the scheduler fired.
        return {
          skipped: 'No database is configured, so alert deliveries cannot be deduplicated.',
        };
      }

      if (!isEmailConfigured()) {
        return {
          skipped:
            'Email is not configured (RESEND_API_KEY and ALERT_TOKEN_SECRET are both required).',
        };
      }

      // The same readings the site is showing, cache and all. Alerting on a
      // fresher snapshot than the page displays would tell somebody about an
      // hour they cannot yet see.
      const { readings, meta } = await getLatestReadings();

      const rows = await listDueSubscriptions();
      if (rows.length === 0) {
        return { detail: { subscriptions: 0, sent: 0, measuredAt: meta.measuredAt } };
      }

      const byId = new Map(rows.map((row) => [row.id, row]));

      /*
       * Signatures already on record, per subscription.
       *
       * One query per subscriber, which is fine at this scale and is only a
       * belt-and-braces check anyway — the unique index is authoritative. Note
       * that a signature is recorded whatever the outcome, so a message that
       * FAILED to send is not retried on the next run. That is a property of the
       * existing schema rather than something decided here, and it is the safer
       * direction: a duplicate warning is worse than a missed one.
       */
      const deliveredSignatures = new Map<string, ReadonlySet<string>>();
      for (const row of rows) {
        deliveredSignatures.set(row.id, await listDeliveredSignatures(row.id));
      }

      const subscriptions = rows.map(toState);
      const { decisions, episodesToClose, skipped } = evaluateAlerts({
        subscriptions,
        readings,
        now,
        deliveredSignatures,
      });

      let sent = 0;
      let failed = 0;
      let duplicates = 0;
      let unsendable = 0;

      for (const decision of decisions) {
        const row = byId.get(decision.subscriptionId);
        if (!row) continue;

        const station = findStation(decision.trigger.stationId);
        if (!station) {
          // An alert without a place is not actionable, and the trigger came
          // from a station id that is no longer in the registry.
          unsendable += 1;
          continue;
        }

        const claim = await claimDelivery({
          subscriptionId: row.id,
          kind: decision.kind,
          signature: decision.deliverySignature,
          stationId: station.id,
          pollutant: decision.trigger.pollutant,
          category: decision.trigger.category,
          measuredAt: new Date(decision.trigger.measuredAt),
          forecast: decision.trigger.basis === 'forecast',
          status: 'queued',
        });

        if (!claim) {
          duplicates += 1;
          continue;
        }

        const unsubscribe = createUnsubscribeToken(normaliseEmail(row.email));
        if (!unsubscribe) {
          // Sending mail nobody can unsubscribe from is worse than not sending.
          await completeDelivery(claim.id, {
            status: 'skipped',
            error: 'no_unsubscribe_token',
          });
          unsendable += 1;
          continue;
        }

        const links = buildEmailLinks({ unsubscribeToken: unsubscribe.token, station });

        let content: EmailContent;

        if (decision.kind === 'improvement') {
          if (!decision.previousCategory) {
            /*
             * An improvement notice has to name the band the episode peaked at.
             * `previousCategory` is null only when the stored episode signature
             * could not be parsed, so there is nothing honest to say — the
             * episode is closed instead, which re-arms the alert for the next one.
             */
            await completeDelivery(claim.id, {
              status: 'skipped',
              error: 'unparseable_episode_signature',
            });
            await recordSubscriptionAlertState(row.id, null, now);
            unsendable += 1;
            continue;
          }

          content = improvementNoticeEmail({
            areaName: station.locality,
            stationName: station.name,
            category: decision.trigger.category,
            previousCategory: decision.previousCategory,
            dominantPollutant: decision.trigger.pollutant,
            value: decision.trigger.value,
            unit: decision.trigger.unit,
            measuredAtIso: decision.trigger.measuredAt,
            basis: decision.trigger.basis,
            links,
          });
        } else {
          content = airQualityAlertEmail({
            areaName: station.locality,
            stationName: station.name,
            category: decision.trigger.category,
            dominantPollutant: decision.trigger.pollutant,
            value: decision.trigger.value,
            unit: decision.trigger.unit,
            measuredAtIso: decision.trigger.measuredAt,
            basis: decision.trigger.basis,
            links,
          });
        }

        const result = await sendEmail({
          to: row.email,
          subject: content.subject,
          text: content.text,
          html: content.html,
          unsubscribeUrl: links.unsubscribeUrl,
          tags: [{ name: 'kind', value: decision.kind }],
        });

        if (!result.sent) {
          await completeDelivery(claim.id, {
            status: 'failed',
            error: result.error ?? result.reason,
          });
          // The episode is deliberately NOT recorded: nothing reached the
          // subscriber, so the next run should still consider this episode new.
          failed += 1;
          continue;
        }

        await completeDelivery(claim.id, { status: 'sent', providerMessageId: result.messageId });
        await recordSubscriptionAlertState(row.id, decision.nextEpisodeSignature, now);
        sent += 1;
      }

      /*
       * Episodes that ended for somebody who did not ask for improvement notices.
       *
       * Their stored signature must still be cleared, or the next genuine episode
       * at the same band would look "unchanged" and be suppressed forever. Silent
       * when missed, which is why the evaluator returns it explicitly.
       */
      for (const episode of episodesToClose) {
        await recordSubscriptionAlertState(episode.subscriptionId, null, now);
      }

      /* ------------------------------------------------------------------ */
      /*  Weekly digests                                                     */
      /* ------------------------------------------------------------------ */

      const periodStart = weeklyPeriodStart(now);
      const periodEnd = new Date(periodStart.getTime() + WEEKLY_EXPECTED_HOURS * 60 * 60 * 1000);
      const digestSignature = weeklySummarySignature(periodStart);

      const digestDue = rows.filter((row) =>
        isWeeklySummaryDue(toState(row), now, deliveredSignatures.get(row.id)),
      );

      let digestsSent = 0;
      let digestsFailed = 0;

      if (digestDue.length > 0) {
        // Queried once for everybody, not once per subscriber: the window is the
        // same for all of them, which is what makes two people's digests
        // comparable in the first place.
        const byStation = summariseWeek(
          await getReadingsInWindow({ from: periodStart, to: periodEnd }),
        );

        for (const row of digestDue) {
          const claim = await claimDelivery({
            subscriptionId: row.id,
            kind: 'weekly-summary',
            signature: digestSignature,
            stationId: row.stationId,
            pollutant: null,
            category: null,
            // A digest describes a period, not a triggering hour.
            measuredAt: null,
            forecast: false,
            status: 'queued',
          });

          if (!claim) {
            duplicates += 1;
            continue;
          }

          const unsubscribe = createUnsubscribeToken(normaliseEmail(row.email));
          if (!unsubscribe) {
            await completeDelivery(claim.id, {
              status: 'skipped',
              error: 'no_unsubscribe_token',
            });
            unsendable += 1;
            continue;
          }

          const station = row.stationId ? findStation(row.stationId) : null;
          const links = buildEmailLinks({ unsubscribeToken: unsubscribe.token, station });

          const content = weeklySummaryEmail({
            periodStartIso: periodStart.toISOString(),
            periodEndIso: periodEnd.toISOString(),
            stations: weeklyStationSummaries(byStation, row.stationId),
            links,
          });

          const result = await sendEmail({
            to: row.email,
            subject: content.subject,
            text: content.text,
            html: content.html,
            unsubscribeUrl: links.unsubscribeUrl,
            tags: [{ name: 'kind', value: 'weekly-summary' }],
          });

          if (!result.sent) {
            await completeDelivery(claim.id, {
              status: 'failed',
              error: result.error ?? result.reason,
            });
            digestsFailed += 1;
            continue;
          }

          await completeDelivery(claim.id, {
            status: 'sent',
            providerMessageId: result.messageId,
          });
          // Deliberately no `recordSubscriptionAlertState`: a digest is not an
          // episode, and touching `lastAlertAt` would let a routine summary delay
          // a genuine warning through the quiet period.
          digestsSent += 1;
        }
      }

      logger.info('alerts.evaluated', {
        subscriptions: rows.length,
        decisions: decisions.length,
        sent,
        failed,
        duplicates,
        unsendable,
        episodesClosed: episodesToClose.length,
        digestsSent,
        digestsFailed,
      });

      return {
        detail: {
          subscriptions: rows.length,
          decisions: decisions.length,
          sent,
          failed,
          duplicates,
          unsendable,
          skipped: skipped.length,
          episodesClosed: episodesToClose.length,
          digestsSent,
          digestsFailed,
          measuredAt: meta.measuredAt,
          readingsStale: meta.stale,
        },
      };
    },
  );
}
