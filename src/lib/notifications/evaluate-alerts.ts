/**
 * Alert evaluation.
 *
 * Pure and deterministic: subscriptions and readings in, decisions out. No
 * clock beyond the injected `now`, no database, no email, no randomness. Sending
 * is somebody else's job, which is what makes "would this have alerted?"
 * answerable in a unit test rather than only by watching an inbox.
 *
 * The hard requirement it exists to satisfy is deduplication: an episode that
 * has not changed must never send twice. That is a state machine, not a filter,
 * and it needs two distinct signatures to express — see {@link episodeSignature}
 * and {@link deliverySignature}.
 */

import type { PollutantCode } from '@/config/pollutants';
import { CATEGORY_TO_BAND_ID, categoryRank, type AirQualityCategory } from '@/config/thresholds';
import { isStale } from '@/lib/air-quality/freshness';
import type { PollutantReading, StationReading } from '@/lib/air-quality/types';
import type { AlertType } from '@/db/schema';

/**
 * The band at which an unconfigured subscription starts alerting.
 *
 * `Poor` is the first category the EEA marks as warranting a prominent warning
 * (`CATEGORY_PRESENTATION[...].elevated`), so it is the first at which an
 * unsolicited email is justified rather than merely informative.
 */
export const DEFAULT_THRESHOLD_CATEGORY: AirQualityCategory = 'Poor';

/** Default anti-flap floor between two messages to the same subscriber. */
export const DEFAULT_MIN_HOURS_BETWEEN_ALERTS = 6;

/** Everything the evaluator needs to know about one subscription. */
export type AlertSubscriptionState = {
  id: string;
  email: string;
  locale: string;
  alertTypes: readonly AlertType[];
  /** `null` means anywhere in the Maltese islands. */
  stationId: string | null;
  /** `null` means whichever pollutant is driving the index. */
  pollutant: PollutantCode | null;
  /** `null` falls back to {@link DEFAULT_THRESHOLD_CATEGORY}. */
  thresholdCategory: AirQualityCategory | null;
  minHoursBetweenAlerts: number;
  verified: boolean;
  paused: boolean;
  unsubscribedAt: Date | null;
  lastAlertAt: Date | null;
  /** The episode signature of the last alert sent, or `null` if none is open. */
  lastAlertSignature: string | null;
};

/** Whether a triggering figure was measured or produced by a model. */
export type ReadingBasis = 'measured' | 'forecast';

export type AlertTrigger = {
  stationId: string;
  pollutant: PollutantCode;
  category: AirQualityCategory;
  subIndex: number;
  value: number | null;
  unit: string;
  /** ISO-8601 instant the reading refers to. */
  measuredAt: string;
  basis: ReadingBasis;
};

export type AlertDecision = {
  subscriptionId: string;
  kind: 'air-quality' | 'improvement';
  trigger: AlertTrigger;
  /** Peak category of the episode being closed. Only set for improvements. */
  previousCategory: AirQualityCategory | null;
  /**
   * What to store on the subscription after sending. `null` closes the episode,
   * which is what re-arms the alert for the next one.
   */
  nextEpisodeSignature: string | null;
  /** Idempotency key for this exact message. */
  deliverySignature: string;
};

export type SkipReason =
  | 'not-verified'
  | 'paused'
  | 'unsubscribed'
  | 'not-subscribed-to-type'
  | 'no-matching-station'
  | 'no-usable-reading'
  | 'stale-data'
  | 'below-threshold'
  | 'unchanged-episode'
  | 'within-quiet-period'
  | 'already-delivered'
  | 'no-open-episode';

export type SkippedSubscription = {
  subscriptionId: string;
  reason: SkipReason;
};

export type EvaluateAlertsInput = {
  subscriptions: readonly AlertSubscriptionState[];
  readings: readonly StationReading[];
  now: Date;
  /**
   * Delivery signatures already on record, keyed by subscription id.
   *
   * A belt-and-braces check only. The authoritative guard is the unique index on
   * `alert_deliveries (subscription_id, signature)`, because two concurrent cron
   * invocations can both pass this one.
   */
  deliveredSignatures?: ReadonlyMap<string, ReadonlySet<string>>;
};

export type EvaluateAlertsResult = {
  decisions: AlertDecision[];
  /**
   * Subscriptions whose episode has ended but who receive no improvement notice
   * — because they did not opt into one.
   *
   * Their stored signature must still be cleared, otherwise the next genuine
   * episode at the same category would look "unchanged" and be suppressed
   * forever. Easy to miss, and silent when missed, which is why it is a separate
   * output rather than an implicit side effect.
   */
  episodesToClose: { subscriptionId: string }[];
  skipped: SkippedSubscription[];
};

/* -------------------------------------------------------------------------- */
/*  Signatures                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Identity of an ONGOING EPISODE: place, pollutant, band.
 *
 * Deliberately free of any timestamp. While this string is unchanged the
 * situation is unchanged, so nothing re-sends — that is the whole deduplication
 * rule in one line. It changes when the band worsens or improves, or when a
 * different pollutant takes over, and each of those is genuinely new information.
 */
export function episodeSignature(trigger: {
  stationId: string;
  pollutant: PollutantCode;
  category: AirQualityCategory;
}): string {
  return `aq:${trigger.stationId}:${trigger.pollutant}:${trigger.category}`;
}

/**
 * Identity of ONE MESSAGE: the episode plus the hour that triggered it.
 *
 * Distinct from the episode signature on purpose. A cron retry five minutes
 * later re-derives the same delivery signature and is rejected; a genuinely new
 * episode months later derives a different one and is not.
 */
export function deliverySignature(
  kind: 'air-quality' | 'improvement',
  trigger: {
    stationId: string;
    pollutant: PollutantCode;
    category: AirQualityCategory;
    measuredAt: string;
  },
): string {
  return `${kind}:${trigger.stationId}:${trigger.pollutant}:${trigger.category}:${trigger.measuredAt}`;
}

export type OpenEpisode = {
  stationId: string;
  pollutant: string;
  category: AirQualityCategory;
};

/**
 * Recover the open episode from a stored signature.
 *
 * The station matters as much as the band: an improvement notice has to describe
 * the place that was bad, not merely the worst place that is now fine. Parsing
 * is safe because none of the three components can contain a colon — station ids
 * are `MT000nn`, pollutant codes are `PM2.5`/`NO2`/…, and category names are
 * words. Anything unparseable is treated as "no open episode", which fails
 * towards sending rather than towards silence.
 */
function parseEpisodeSignature(signature: string | null): OpenEpisode | null {
  if (!signature) return null;
  const parts = signature.split(':');
  if (parts.length !== 4 || parts[0] !== 'aq') return null;
  const [, stationId, pollutant, category] = parts;
  if (!stationId || !pollutant || !category || !isCategory(category)) return null;
  return { stationId, pollutant, category };
}

function isCategory(value: string): value is AirQualityCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_TO_BAND_ID, value);
}

/* -------------------------------------------------------------------------- */
/*  Evaluation                                                                */
/* -------------------------------------------------------------------------- */

type Candidate = {
  reading: StationReading;
  pollutantReading: PollutantReading;
  category: AirQualityCategory;
  subIndex: number;
};

/**
 * Usable pollutant readings for a subscription's scope, worst first.
 *
 * Filters applied, and why each one matters:
 *  - station scope, so an alert is about somewhere the subscriber asked about;
 *  - stale readings dropped — alerting on data hours out of date would be
 *    describing the past as the present;
 *  - `value === null` dropped, because there is no measurement to report; a
 *    missing value must never be read as a clean one, nor as a bad one.
 *
 * Ties are broken in favour of a MEASURED reading over a modelled one, so an
 * alert is attributed to real instrument data whenever real data would trigger it.
 */
function candidatesFor(
  subscription: AlertSubscriptionState,
  readings: readonly StationReading[],
): Candidate[] {
  const scoped = subscription.stationId
    ? readings.filter((r) => r.stationId === subscription.stationId)
    : readings;

  const candidates: Candidate[] = [];

  for (const reading of scoped) {
    if (isStale(reading.freshness)) continue;

    for (const pollutantReading of Object.values(reading.pollutants)) {
      if (!pollutantReading) continue;
      if (subscription.pollutant && pollutantReading.pollutant !== subscription.pollutant) continue;
      if (pollutantReading.value === null) continue;
      if (pollutantReading.category === null || pollutantReading.subIndex === null) continue;

      candidates.push({
        reading,
        pollutantReading,
        category: pollutantReading.category,
        subIndex: pollutantReading.subIndex,
      });
    }
  }

  return candidates.sort((a, b) => {
    if (b.subIndex !== a.subIndex) return b.subIndex - a.subIndex;
    const aModelled = a.pollutantReading.modelled ? 1 : 0;
    const bModelled = b.pollutantReading.modelled ? 1 : 0;
    if (aModelled !== bModelled) return aModelled - bModelled;
    // Final tiebreak keeps the output stable across runs.
    return a.reading.stationId.localeCompare(b.reading.stationId);
  });
}

function toTrigger(candidate: Candidate): AlertTrigger {
  return {
    stationId: candidate.reading.stationId,
    pollutant: candidate.pollutantReading.pollutant,
    category: candidate.category,
    subIndex: candidate.subIndex,
    value: candidate.pollutantReading.value,
    unit: candidate.pollutantReading.unit,
    measuredAt: candidate.reading.measuredAt,
    // A gap-filled past hour and a forecast future hour are the same thing for
    // the reader: not a direct measurement. Both must be labelled.
    basis: candidate.pollutantReading.modelled ? 'forecast' : 'measured',
  };
}

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (60 * 60 * 1000);
}

/**
 * Decide what to send.
 *
 * The state machine, in full:
 *
 *   no open episode + reading at or above threshold  → send an alert, open the episode
 *   open episode    + same band                      → send nothing
 *   open episode    + worse band                     → send an alert (bypassing the
 *                                                      quiet period), update the episode
 *   open episode    + back below threshold           → send an improvement notice
 *                                                      if subscribed, close the episode
 *   no open episode + below threshold                → send nothing
 *
 * A subscription with no usable reading falls through every branch and closes
 * nothing: silence from a station is not evidence that the air improved.
 */
export function evaluateAlerts(input: EvaluateAlertsInput): EvaluateAlertsResult {
  const decisions: AlertDecision[] = [];
  const episodesToClose: { subscriptionId: string }[] = [];
  const skipped: SkippedSubscription[] = [];

  const skip = (subscriptionId: string, reason: SkipReason) =>
    skipped.push({ subscriptionId, reason });

  for (const subscription of input.subscriptions) {
    if (subscription.unsubscribedAt) {
      skip(subscription.id, 'unsubscribed');
      continue;
    }
    if (!subscription.verified) {
      skip(subscription.id, 'not-verified');
      continue;
    }
    if (subscription.paused) {
      skip(subscription.id, 'paused');
      continue;
    }

    const candidates = candidatesFor(subscription, input.readings);
    if (candidates.length === 0) {
      // Distinguish "we have no station in scope" from "the station reported
      // nothing usable" — they need different fixes, so they get different reasons.
      const hasStationInScope =
        !subscription.stationId ||
        input.readings.some((r) => r.stationId === subscription.stationId);
      skip(subscription.id, hasStationInScope ? 'no-usable-reading' : 'no-matching-station');
      continue;
    }

    const threshold = subscription.thresholdCategory ?? DEFAULT_THRESHOLD_CATEGORY;
    const thresholdRank = categoryRank(threshold);

    const worst = candidates[0];
    const openEpisode = parseEpisodeSignature(subscription.lastAlertSignature);
    const openEpisodeCategory = openEpisode?.category ?? null;

    /* ---------------------------------------------------------------- */
    /*  Below threshold: possibly close an open episode                  */
    /* ---------------------------------------------------------------- */

    if (categoryRank(worst.category) < thresholdRank) {
      if (!subscription.lastAlertSignature) {
        skip(subscription.id, 'below-threshold');
        continue;
      }

      /*
       * The notice must describe the station whose episode is being closed, not
       * simply the worst station reporting now.
       *
       * For an island-wide subscription those are routinely different: if Msida
       * went Poor and has recovered, using the current worst candidate would
       * produce "Attard has returned to Fair, from Poor earlier" — of a station
       * that was never Poor. Since every station is now below the threshold, the
       * episode station's own worst candidate is the right one, and `candidates`
       * is already sorted worst-first so the first match is it.
       */
      const episodeCandidate = openEpisode
        ? candidates.find((c) => c.reading.stationId === openEpisode.stationId)
        : worst;

      if (!episodeCandidate) {
        // The station that was bad is now reporting nothing usable. Silence is
        // not recovery, so the episode stays open and nothing is sent.
        skip(subscription.id, 'no-usable-reading');
        continue;
      }

      if (!subscription.alertTypes.includes('improvement')) {
        // No notice, but the episode must still be closed or the next one at the
        // same band would be suppressed as "unchanged" indefinitely.
        episodesToClose.push({ subscriptionId: subscription.id });
        skip(subscription.id, 'not-subscribed-to-type');
        continue;
      }

      const trigger = toTrigger(episodeCandidate);
      const signature = deliverySignature('improvement', trigger);

      if (input.deliveredSignatures?.get(subscription.id)?.has(signature)) {
        skip(subscription.id, 'already-delivered');
        continue;
      }

      decisions.push({
        subscriptionId: subscription.id,
        kind: 'improvement',
        trigger,
        previousCategory: openEpisodeCategory,
        nextEpisodeSignature: null,
        deliverySignature: signature,
      });
      continue;
    }

    /* ---------------------------------------------------------------- */
    /*  At or above threshold: possibly open or escalate an episode      */
    /* ---------------------------------------------------------------- */

    if (!subscription.alertTypes.includes('air-quality')) {
      skip(subscription.id, 'not-subscribed-to-type');
      continue;
    }

    const trigger = toTrigger(worst);
    const nextSignature = episodeSignature(trigger);

    if (subscription.lastAlertSignature === nextSignature) {
      skip(subscription.id, 'unchanged-episode');
      continue;
    }

    // An escalation is new information and overrides the quiet period. Anything
    // else — including an improvement that is still above the threshold — waits,
    // so a value oscillating around a band edge cannot produce a burst of mail.
    const escalating =
      openEpisodeCategory !== null &&
      categoryRank(worst.category) > categoryRank(openEpisodeCategory);

    if (!escalating && subscription.lastAlertAt) {
      const quietHours = subscription.minHoursBetweenAlerts ?? DEFAULT_MIN_HOURS_BETWEEN_ALERTS;
      if (hoursBetween(subscription.lastAlertAt, input.now) < quietHours) {
        skip(subscription.id, 'within-quiet-period');
        continue;
      }
    }

    const signature = deliverySignature('air-quality', trigger);
    if (input.deliveredSignatures?.get(subscription.id)?.has(signature)) {
      skip(subscription.id, 'already-delivered');
      continue;
    }

    decisions.push({
      subscriptionId: subscription.id,
      kind: 'air-quality',
      trigger,
      previousCategory: openEpisodeCategory,
      nextEpisodeSignature: nextSignature,
      deliverySignature: signature,
    });
  }

  decisions.sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId));
  return { decisions, episodesToClose, skipped };
}

/* -------------------------------------------------------------------------- */
/*  Weekly summary                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Signature for a weekly digest.
 *
 * Keyed by the ISO date the period starts on, so the same week can only ever be
 * sent once however often the scheduler fires.
 */
export function weeklySummarySignature(periodStart: Date): string {
  return `weekly-summary:${periodStart.toISOString().slice(0, 10)}`;
}

/**
 * Start of the seven-day period ending at `now`, aligned to midnight UTC.
 *
 * Aligned rather than rolling so that every subscriber's digest covers exactly
 * the same window, which is what makes two people's summaries comparable.
 */
export function weeklyPeriodStart(now: Date): Date {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
}

/** Whether this subscription should receive the digest for the current period. */
export function isWeeklySummaryDue(
  subscription: Pick<
    AlertSubscriptionState,
    'id' | 'verified' | 'paused' | 'unsubscribedAt' | 'alertTypes'
  >,
  now: Date,
  deliveredSignatures?: ReadonlySet<string>,
): boolean {
  if (subscription.unsubscribedAt || !subscription.verified || subscription.paused) return false;
  if (!subscription.alertTypes.includes('weekly-summary')) return false;
  return !deliveredSignatures?.has(weeklySummarySignature(weeklyPeriodStart(now)));
}
