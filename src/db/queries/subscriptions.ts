/**
 * Alert subscription persistence.
 *
 * Three rules run through every function here:
 *
 *  1. **Only hashes are stored.** Raw confirmation and unsubscribe tokens exist
 *     solely in the emails that carried them. Lookups are by hash, so a stolen
 *     database yields no working link.
 *  2. **Nothing enumerates.** Functions that a public route can reach return the
 *     same shape whether or not an address exists. The routes must not branch
 *     their response on the difference.
 *  3. **Unsubscribing sets a flag, it does not delete.** A deleted row could be
 *     recreated by a replayed subscribe request; a tombstoned one cannot, and it
 *     leaves an auditable record of the request. The row is purged later by the
 *     retention job.
 */

import { and, eq, isNull, lte, sql } from 'drizzle-orm';

import type { PollutantCode } from '@/config/pollutants';
import type { AirQualityCategory } from '@/config/thresholds';
import { logger } from '@/lib/monitoring/logger';
import { withDb } from '../client';
import { retentionCutoff } from '../retention';
import {
  alertDeliveries,
  alertSubscriptions,
  type AlertSubscriptionRow,
  type AlertType,
  type NewAlertDeliveryRow,
  type PendingSubscriptionPreferences,
} from '../schema';

/** Lower-cased and trimmed. The stored identity of an address. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type CreateSubscriptionInput = {
  email: string;
  alertTypes: AlertType[];
  stationId?: string | null;
  pollutant?: PollutantCode | null;
  thresholdCategory?: AirQualityCategory | null;
  minHoursBetweenAlerts?: number;
  locale?: string;
  /** SHA-256 of the confirmation token. Never the token itself. */
  confirmationTokenHash: string;
  confirmationExpiresAt: Date;
  /** SHA-256 of the unsubscribe token. Never the token itself. */
  unsubscribeTokenHash: string;
};

export type CreateSubscriptionResult =
  | { stored: true; subscription: AlertSubscriptionRow; alreadyVerified: boolean }
  | { stored: false; reason: 'no_database' };

/**
 * Create a pending subscription, or attach a fresh confirmation request to an
 * existing one.
 *
 * On conflict this touches ONLY the confirmation token and the pending
 * preferences. It deliberately does not change `verified`, `paused`,
 * `unsubscribedAt` or any live preference column, because a subscribe request is
 * evidence that somebody typed an address — not that its owner did. Anything
 * else would let a stranger resume a cancelled subscription, or rewrite a
 * subscriber's settings, simply by knowing their address. The confirmation step
 * is what promotes the pending preferences into effect.
 *
 * The unsubscribe token hash is also left alone: it is derived deterministically
 * from the address (see `lib/notifications/tokens.ts`), so it is already correct,
 * and rewriting it would break the links in every email already delivered.
 */
export async function createSubscription(
  input: CreateSubscriptionInput,
  now: Date = new Date(),
): Promise<CreateSubscriptionResult> {
  const emailNormalised = normaliseEmail(input.email);

  const preferences: PendingSubscriptionPreferences = {
    alertTypes: input.alertTypes,
    stationId: input.stationId ?? null,
    pollutant: input.pollutant ?? null,
    thresholdCategory: input.thresholdCategory ?? null,
    minHoursBetweenAlerts: input.minHoursBetweenAlerts ?? 6,
    locale: input.locale ?? 'en',
  };

  return withDb(
    'subscriptions.createSubscription',
    { stored: false, reason: 'no_database' } as CreateSubscriptionResult,
    async (db) => {
      const rows = await db
        .insert(alertSubscriptions)
        .values({
          email: input.email.trim(),
          emailNormalised,
          verified: false,
          confirmationTokenHash: input.confirmationTokenHash,
          confirmationSentAt: now,
          confirmationExpiresAt: input.confirmationExpiresAt,
          unsubscribeTokenHash: input.unsubscribeTokenHash,
          // A brand-new row is unverified, so its live columns are inert until
          // confirmation; seeding them keeps the row self-describing.
          alertTypes: preferences.alertTypes,
          stationId: preferences.stationId,
          pollutant: preferences.pollutant,
          thresholdCategory: preferences.thresholdCategory,
          minHoursBetweenAlerts: preferences.minHoursBetweenAlerts,
          locale: preferences.locale,
          pendingPreferences: preferences,
          paused: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: alertSubscriptions.emailNormalised,
          set: {
            confirmationTokenHash: sql`excluded.confirmation_token_hash`,
            confirmationSentAt: sql`excluded.confirmation_sent_at`,
            confirmationExpiresAt: sql`excluded.confirmation_expires_at`,
            pendingPreferences: sql`excluded.pending_preferences`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .returning();

      const subscription = rows[0];
      if (!subscription) return { stored: false, reason: 'no_database' };

      return { stored: true, subscription, alreadyVerified: subscription.verified };
    },
  );
}

export type ConfirmResult =
  | { confirmed: true; subscription: AlertSubscriptionRow }
  | { confirmed: false; reason: 'not_found' | 'expired' | 'no_database' };

/**
 * Complete double opt-in.
 *
 * This is the only place consent is granted, so it is the only place that:
 *   - sets `verified`,
 *   - clears an `unsubscribedAt` tombstone and un-pauses delivery,
 *   - promotes `pendingPreferences` into the live columns.
 *
 * Confirming also clears `confirmationTokenHash`, making the link single-use: a
 * forwarded email cannot be replayed to re-verify an address later.
 */
export async function confirmSubscription(
  confirmationTokenHash: string,
  now: Date = new Date(),
): Promise<ConfirmResult> {
  return withDb(
    'subscriptions.confirmSubscription',
    { confirmed: false, reason: 'no_database' } as ConfirmResult,
    async (db) => {
      const found = await db
        .select()
        .from(alertSubscriptions)
        .where(eq(alertSubscriptions.confirmationTokenHash, confirmationTokenHash))
        .limit(1);

      const existing = found[0];
      if (!existing) return { confirmed: false, reason: 'not_found' };

      if (
        existing.confirmationExpiresAt &&
        existing.confirmationExpiresAt.getTime() < now.getTime()
      ) {
        return { confirmed: false, reason: 'expired' };
      }

      const pending = existing.pendingPreferences;

      const updated = await db
        .update(alertSubscriptions)
        .set({
          verified: true,
          verifiedAt: existing.verifiedAt ?? now,
          confirmationTokenHash: null,
          confirmationExpiresAt: null,
          unsubscribedAt: null,
          paused: false,
          // Only now do the requested settings take effect. A missing pending
          // block means the row is being re-confirmed unchanged, so the live
          // columns are left as they are rather than reset to defaults.
          ...(pending
            ? {
                alertTypes: pending.alertTypes,
                stationId: pending.stationId,
                pollutant: pending.pollutant,
                thresholdCategory: pending.thresholdCategory,
                minHoursBetweenAlerts: pending.minHoursBetweenAlerts,
                locale: pending.locale,
              }
            : {}),
          pendingPreferences: null,
          // A confirmation starts a clean slate: any episode left open by a
          // previous subscription must not suppress the first new alert.
          lastAlertSignature: null,
          updatedAt: now,
        })
        .where(eq(alertSubscriptions.id, existing.id))
        .returning();

      const subscription = updated[0];
      if (!subscription) return { confirmed: false, reason: 'not_found' };

      logger.info('alerts.subscription_confirmed', { subscriptionId: subscription.id });
      return { confirmed: true, subscription };
    },
  );
}

/**
 * Unsubscribe by token hash.
 *
 * Returns a boolean for LOGGING only. The route must answer identically whether
 * this returned true or false — an honest "no such subscription" response would
 * turn the endpoint into an address oracle.
 */
export async function unsubscribeByTokenHash(
  unsubscribeTokenHash: string,
  now: Date = new Date(),
): Promise<boolean> {
  return withDb('subscriptions.unsubscribe', false, async (db) => {
    const updated = await db
      .update(alertSubscriptions)
      .set({
        unsubscribedAt: now,
        paused: true,
        // Re-arm nothing: a resubscribe starts from a clean episode state.
        lastAlertSignature: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(alertSubscriptions.unsubscribeTokenHash, unsubscribeTokenHash),
          isNull(alertSubscriptions.unsubscribedAt),
        ),
      )
      .returning({ id: alertSubscriptions.id });

    if (updated.length > 0) {
      logger.info('alerts.subscription_unsubscribed', { subscriptionId: updated[0].id });
    }
    return updated.length > 0;
  });
}

/** Pause or resume delivery without unsubscribing. Same non-enumerating contract. */
export async function setSubscriptionPaused(
  unsubscribeTokenHash: string,
  paused: boolean,
  now: Date = new Date(),
): Promise<boolean> {
  return withDb('subscriptions.setPaused', false, async (db) => {
    const updated = await db
      .update(alertSubscriptions)
      .set({ paused, updatedAt: now })
      .where(
        and(
          eq(alertSubscriptions.unsubscribeTokenHash, unsubscribeTokenHash),
          isNull(alertSubscriptions.unsubscribedAt),
        ),
      )
      .returning({ id: alertSubscriptions.id });

    return updated.length > 0;
  });
}

/**
 * Subscriptions eligible to receive a message right now.
 *
 * Verified, not paused, not unsubscribed. Whether a given subscription actually
 * fires is decided by `evaluate-alerts.ts`, which is pure and testable — this
 * function only narrows the candidate set.
 */
export async function listDueSubscriptions(): Promise<AlertSubscriptionRow[]> {
  return withDb('subscriptions.listDue', [] as AlertSubscriptionRow[], (db) =>
    db
      .select()
      .from(alertSubscriptions)
      .where(
        and(
          eq(alertSubscriptions.verified, true),
          eq(alertSubscriptions.paused, false),
          isNull(alertSubscriptions.unsubscribedAt),
        ),
      ),
  );
}

/** Look up by unsubscribe token hash, for the manage-preferences view. */
export async function findSubscriptionByUnsubscribeHash(
  unsubscribeTokenHash: string,
): Promise<AlertSubscriptionRow | null> {
  return withDb(
    'subscriptions.findByUnsubscribeHash',
    null as AlertSubscriptionRow | null,
    async (db) => {
      const rows = await db
        .select()
        .from(alertSubscriptions)
        .where(eq(alertSubscriptions.unsubscribeTokenHash, unsubscribeTokenHash))
        .limit(1);
      return rows[0] ?? null;
    },
  );
}

/**
 * Record that an episode was notified.
 *
 * `lastAlertSignature` is the state of the episode, not the identity of the
 * message; while it is unchanged nothing re-sends. Passing `null` clears it,
 * which is how an improvement notice re-arms the alert for the next episode.
 */
export async function recordSubscriptionAlertState(
  subscriptionId: string,
  signature: string | null,
  now: Date = new Date(),
): Promise<void> {
  await withDb('subscriptions.recordAlertState', undefined, async (db) => {
    await db
      .update(alertSubscriptions)
      .set({ lastAlertAt: now, lastAlertSignature: signature, updatedAt: now })
      .where(eq(alertSubscriptions.id, subscriptionId));
  });
}

/* -------------------------------------------------------------------------- */
/*  Deliveries                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Claim a delivery slot before sending.
 *
 * The unique index on `(subscription_id, signature)` is the real guard against a
 * duplicate send: two concurrent cron invocations both insert, exactly one wins,
 * and the loser gets `false` and sends nothing. Doing this check in application
 * code instead would leave a race window between the check and the send.
 *
 * @returns the claimed row, or `null` if this message was already claimed or
 *          there is no database (in which case nothing should be sent, because
 *          nothing could be deduplicated).
 */
export async function claimDelivery(row: NewAlertDeliveryRow): Promise<{ id: string } | null> {
  return withDb('subscriptions.claimDelivery', null as { id: string } | null, async (db) => {
    const inserted = await db
      .insert(alertDeliveries)
      .values({ ...row, status: row.status ?? 'queued' })
      .onConflictDoNothing({
        target: [alertDeliveries.subscriptionId, alertDeliveries.signature],
      })
      .returning({ id: alertDeliveries.id });

    return inserted[0] ?? null;
  });
}

/** Close out a claimed delivery with its outcome. */
export async function completeDelivery(
  deliveryId: string,
  outcome:
    | { status: 'sent'; providerMessageId: string | null }
    | { status: 'failed'; error: string }
    | { status: 'skipped'; error?: string },
  now: Date = new Date(),
): Promise<void> {
  await withDb('subscriptions.completeDelivery', undefined, async (db) => {
    await db
      .update(alertDeliveries)
      .set({
        status: outcome.status,
        providerMessageId: outcome.status === 'sent' ? outcome.providerMessageId : null,
        error: outcome.status === 'sent' ? null : (outcome.error ?? null),
        sentAt: outcome.status === 'sent' ? now : null,
      })
      .where(eq(alertDeliveries.id, deliveryId));
  });
}

/** Delivery signatures already recorded for a subscription, so the pure evaluator
 *  can be told what has been sent without querying inside it. */
export async function listDeliveredSignatures(subscriptionId: string): Promise<Set<string>> {
  const rows = await withDb(
    'subscriptions.listDeliveredSignatures',
    [] as { signature: string }[],
    (db) =>
      db
        .select({ signature: alertDeliveries.signature })
        .from(alertDeliveries)
        .where(eq(alertDeliveries.subscriptionId, subscriptionId)),
  );

  return new Set(rows.map((r) => r.signature));
}

/* -------------------------------------------------------------------------- */
/*  Retention                                                                 */
/* -------------------------------------------------------------------------- */

export type SubscriptionCleanupResult = {
  deliveries: number;
  unsubscribed: number;
  unconfirmed: number;
};

/**
 * Purge expired alert data.
 *
 * Unsubscribed and never-confirmed rows are deleted outright rather than
 * anonymised: there is no analytical value in a bare row here, and holding an
 * address that its owner never confirmed — or asked to be removed from — is the
 * thing the policy exists to prevent.
 */
export async function pruneAlertData(now: Date = new Date()): Promise<SubscriptionCleanupResult> {
  const deliveryCutoff = retentionCutoff('alertDeliveries', now);
  const unsubscribedCutoff = retentionCutoff('unsubscribedSubscriptions', now);
  const unconfirmedCutoff = retentionCutoff('unconfirmedSubscriptions', now);

  return withDb(
    'subscriptions.prune',
    { deliveries: 0, unsubscribed: 0, unconfirmed: 0 },
    async (db) => {
      let deliveries = 0;
      let unsubscribed = 0;
      let unconfirmed = 0;

      if (deliveryCutoff) {
        const removed = await db
          .delete(alertDeliveries)
          .where(lte(alertDeliveries.createdAt, deliveryCutoff))
          .returning({ id: alertDeliveries.id });
        deliveries = removed.length;
      }

      if (unsubscribedCutoff) {
        const removed = await db
          .delete(alertSubscriptions)
          .where(lte(alertSubscriptions.unsubscribedAt, unsubscribedCutoff))
          .returning({ id: alertSubscriptions.id });
        unsubscribed = removed.length;
      }

      if (unconfirmedCutoff) {
        const removed = await db
          .delete(alertSubscriptions)
          .where(
            and(
              eq(alertSubscriptions.verified, false),
              lte(alertSubscriptions.createdAt, unconfirmedCutoff),
              // `verified` is cleared nowhere, but `verifiedAt` is the durable
              // record that consent was once given. Requiring it to be absent
              // means a row that confirmed and was later somehow un-flagged is
              // never silently deleted by the retention job.
              isNull(alertSubscriptions.verifiedAt),
            ),
          )
          .returning({ id: alertSubscriptions.id });
        unconfirmed = removed.length;
      }

      logger.info('alerts.pruned', { deliveries, unsubscribed, unconfirmed });
      return { deliveries, unsubscribed, unconfirmed };
    },
  );
}
