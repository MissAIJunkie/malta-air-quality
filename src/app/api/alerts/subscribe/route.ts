/**
 * POST /api/alerts/subscribe
 *
 * Start a double opt-in email subscription. Nothing is ever sent to an address
 * until the confirmation link in the one confirmation email has been followed.
 *
 * The response is identical whether the address is new, already pending or
 * already confirmed. That is not laziness: a response that distinguished them
 * would turn this endpoint into an oracle for "does this person use maqua.app?".
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { getCapabilities } from '@/config/env';
import { findStation } from '@/config/stations';
import { pollutantFromSlug } from '@/config/pollutants';
import { AIR_QUALITY_CATEGORIES } from '@/config/thresholds';
import { isDatabaseConfigured } from '@/db/client';
import { ALERT_TYPES, type AlertType } from '@/db/schema';
import { createSubscription, normaliseEmail } from '@/db/queries/subscriptions';
import {
  badRequest,
  handleRouteError,
  ok,
  serviceUnavailable,
  tooManyRequests,
} from '@/lib/api/respond';
import { logger } from '@/lib/monitoring/logger';
import { isEmailConfigured, sendEmail } from '@/lib/notifications/resend-client';
import { identifierFromHeaders, rateLimit } from '@/lib/security/rate-limit';
import { confirmSubscriptionEmail } from '@/lib/notifications/templates';
import { createSubscriptionTokens } from '@/lib/notifications/tokens';
import {
  NO_STORE,
  alertsResponseMeta,
  buildEmailLinks,
  confirmUrl,
  describeSubscription,
} from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `immediate` still carries a one-hour floor because upstream republishes hourly
 * — anything shorter could only ever re-send the same hour.
 */
const FREQUENCY_TO_QUIET_HOURS = {
  immediate: 1,
  daily: 24,
} as const;

const subscribeSchema = z.object({
  // Zod's own address check, not a hand-rolled regular expression: every
  // home-made email pattern eventually rejects a real address.
  email: z.email().max(254),
  /** Explicit, affirmative consent. Required — a pre-ticked box is not consent. */
  consent: z.literal(true),
  alertTypes: z
    .array(z.enum(ALERT_TYPES))
    .min(1)
    .max(ALERT_TYPES.length)
    .default(['air-quality'] as AlertType[]),
  /** Station slug or upstream id. Omitted means anywhere in the islands. */
  station: z.string().min(1).max(64).optional(),
  /** Pollutant slug, e.g. `pm25`. Omitted means the driving pollutant. */
  pollutant: z.string().min(1).max(16).optional(),
  thresholdCategory: z.enum(AIR_QUALITY_CATEGORIES).optional(),
  frequency: z.enum(['immediate', 'daily']).default('immediate'),
  locale: z.enum(['en', 'mt', 'fr']).default('en'),
});

/**
 * The only success body this route ever returns.
 *
 * Deliberately says "if that address can receive alerts" rather than "we sent
 * you an email", because the caller is not told whether an email was in fact
 * sent.
 */
const ACCEPTED = {
  status: 'pending_confirmation' as const,
  message:
    'If that address can receive alerts, a confirmation link is on its way. Alerts start only once you follow it.',
};

export async function POST(request: NextRequest) {
  try {
    const rate = await rateLimit('api/subscribe', identifierFromHeaders(request.headers));
    if (!rate.success) return tooManyRequests(rate.retryAfterSeconds);

    // Capability checks come before parsing so a deployment without email tells
    // the truth immediately rather than validating a form it can never honour.
    if (!getCapabilities().email || !isEmailConfigured()) {
      return serviceUnavailable(
        'Email alerts are not enabled on this deployment. Everything else on maqua.app works without them.',
      );
    }
    if (!isDatabaseConfigured()) {
      return serviceUnavailable(
        'Email alerts need a database, which is not configured on this deployment.',
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Expected a JSON body.');
    }

    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const field = first?.path.join('.') ?? 'request';
      return badRequest(
        field === 'consent'
          ? 'Please confirm you would like to receive these emails.'
          : `Invalid ${field}.`,
      );
    }

    const input = parsed.data;

    const station = input.station ? findStation(input.station) : null;
    if (input.station && !station) return badRequest('Unknown station.');

    const pollutant = input.pollutant ? pollutantFromSlug(input.pollutant) : null;
    if (input.pollutant && !pollutant) return badRequest('Unknown pollutant.');

    const emailNormalised = normaliseEmail(input.email);
    const tokens = createSubscriptionTokens(emailNormalised);
    if (!tokens) {
      // isEmailConfigured() already covers this; belt and braces, because issuing
      // an unsigned token would be far worse than a 503.
      return serviceUnavailable('Email alerts are not enabled on this deployment.');
    }

    const created = await createSubscription({
      email: input.email,
      alertTypes: input.alertTypes,
      stationId: station?.id ?? null,
      pollutant,
      thresholdCategory: input.thresholdCategory ?? null,
      minHoursBetweenAlerts: FREQUENCY_TO_QUIET_HOURS[input.frequency],
      locale: input.locale,
      confirmationTokenHash: tokens.confirmation.tokenHash,
      confirmationExpiresAt: tokens.confirmation.expiresAt ?? new Date(Date.now() + 48 * 3600_000),
      unsubscribeTokenHash: tokens.unsubscribe.tokenHash,
    });

    if (!created.stored) {
      return serviceUnavailable('Alerts could not be set up right now. Please try again shortly.');
    }

    const links = buildEmailLinks({ unsubscribeToken: tokens.unsubscribe.token, station });

    const email = confirmSubscriptionEmail({
      subscriptionDescription: describeSubscription({
        stationId: station?.id ?? null,
        pollutant,
        thresholdCategory: input.thresholdCategory ?? null,
        weeklySummary: input.alertTypes.includes('weekly-summary'),
        improvementNotices: input.alertTypes.includes('improvement'),
      }),
      confirmUrl: confirmUrl(tokens.confirmation.token),
      expiresAtIso: (tokens.confirmation.expiresAt ?? new Date()).toISOString(),
      links,
    });

    const sent = await sendEmail({
      to: input.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      unsubscribeUrl: links.unsubscribeUrl,
      tags: [{ name: 'kind', value: 'confirmation' }],
    });

    if (!sent.sent) {
      // Logged, not surfaced. Telling the caller the send failed would reveal
      // that the address reached the send stage at all.
      logger.warn('alerts.confirmation_send_failed', {
        subscriptionId: created.subscription.id,
        reason: sent.reason,
      });
    }

    return ok(ACCEPTED, alertsResponseMeta(), NO_STORE);
  } catch (error) {
    return handleRouteError('/api/alerts/subscribe', error);
  }
}
