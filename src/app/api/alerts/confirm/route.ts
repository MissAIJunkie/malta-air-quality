/**
 * GET / POST /api/alerts/confirm?token=…
 *
 * Completes double opt-in. Until this succeeds, the address has received exactly
 * one email and will receive nothing else.
 *
 * Two verbs because the endpoint has two audiences. A person clicking a link in
 * their inbox issues a GET and should land on a page, so GET redirects to
 * `/alerts` with a `state` describing the outcome. A script wants a machine
 * answer, so POST returns the standard `{ data, meta }` envelope.
 *
 * The signature is verified before any database work happens, so a forged token
 * costs one HMAC and never touches a row.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getCapabilities } from '@/config/env';
import { isDatabaseConfigured } from '@/db/client';
import { confirmSubscription } from '@/db/queries/subscriptions';
import {
  badRequest,
  handleRouteError,
  ok,
  serviceUnavailable,
  tooManyRequests,
} from '@/lib/api/respond';
import { logger } from '@/lib/monitoring/logger';
import { identifierFromHeaders, rateLimit } from '@/lib/security/rate-limit';
import { verifyToken } from '@/lib/notifications/tokens';
import { NO_STORE, alertsPageUrl, alertsResponseMeta } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const tokenSchema = z.string().min(16).max(1024);

type Outcome = 'confirmed' | 'confirm-invalid' | 'confirm-expired' | 'alerts-unavailable';

async function resolve(token: string | null): Promise<Outcome> {
  if (!getCapabilities().email || !isDatabaseConfigured()) return 'alerts-unavailable';

  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return 'confirm-invalid';

  const verified = verifyToken(parsed.data, 'confirm');
  if (!verified.valid) {
    logger.info('alerts.confirm_rejected', { reason: verified.reason });
    return verified.reason === 'expired' ? 'confirm-expired' : 'confirm-invalid';
  }

  const result = await confirmSubscription(verified.tokenHash);
  if (result.confirmed) return 'confirmed';

  // A valid signature whose hash is not on file means the link was already used
  // — confirming clears the hash, making the link single-use.
  return result.reason === 'expired' ? 'confirm-expired' : 'confirm-invalid';
}

export async function GET(request: NextRequest) {
  try {
    const rate = await rateLimit('api/alerts/confirm', identifierFromHeaders(request.headers));
    if (!rate.success) return tooManyRequests(rate.retryAfterSeconds);

    const outcome = await resolve(request.nextUrl.searchParams.get('token'));

    // 303 rather than 302: the browser must follow with a GET, and the token
    // must not survive into the redirect target's URL or its Referer header.
    return NextResponse.redirect(alertsPageUrl(outcome), {
      status: 303,
      headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    });
  } catch (error) {
    return handleRouteError('/api/alerts/confirm', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const rate = await rateLimit('api/alerts/confirm', identifierFromHeaders(request.headers));
    if (!rate.success) return tooManyRequests(rate.retryAfterSeconds);

    let token = request.nextUrl.searchParams.get('token');
    if (!token) {
      try {
        const body = (await request.json()) as { token?: unknown };
        token = typeof body.token === 'string' ? body.token : null;
      } catch {
        return badRequest('Expected a token, either as a query parameter or in a JSON body.');
      }
    }

    const outcome = await resolve(token);

    if (outcome === 'alerts-unavailable') {
      return serviceUnavailable('Email alerts are not enabled on this deployment.');
    }
    if (outcome !== 'confirmed') {
      return badRequest(
        outcome === 'confirm-expired'
          ? 'That confirmation link has expired. Please sign up again.'
          : 'That confirmation link is not valid or has already been used.',
      );
    }

    return ok(
      { status: 'confirmed' as const, message: 'Confirmed. Your alerts are active.' },
      alertsResponseMeta(),
      NO_STORE,
    );
  } catch (error) {
    return handleRouteError('/api/alerts/confirm', error);
  }
}
