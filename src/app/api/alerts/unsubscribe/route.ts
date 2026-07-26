/**
 * GET / POST / DELETE /api/alerts/unsubscribe?token=…
 *
 * One click, no login, no confirmation step, no "are you sure?".
 *
 * Two rules govern the responses here:
 *
 *  - **Always success-shaped.** An unknown, expired, forged or already-used
 *    token produces the same 200 as a real one. Anything else would let a caller
 *    learn whether an address is subscribed, and an unsubscribe endpoint is the
 *    last place that should leak.
 *  - **POST must work unauthenticated.** `List-Unsubscribe-Post` makes mail
 *    clients POST this URL with no cookies and no CSRF token; rejecting that
 *    would push people towards the spam button instead.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getCapabilities } from '@/config/env';
import { isDatabaseConfigured } from '@/db/client';
import { unsubscribeByTokenHash } from '@/db/queries/subscriptions';
import { handleRouteError, ok, tooManyRequests } from '@/lib/api/respond';
import { logger } from '@/lib/monitoring/logger';
import { identifierFromHeaders, rateLimit } from '@/lib/security/rate-limit';
import { verifyToken } from '@/lib/notifications/tokens';
import { NO_STORE, alertsPageUrl, alertsResponseMeta } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const tokenSchema = z.string().min(16).max(1024);

/**
 * The only body this route returns.
 *
 * Phrased so it is true in every case, including the one where no such
 * subscription ever existed: after this request, that address is not subscribed.
 */
const UNSUBSCRIBED = {
  status: 'unsubscribed' as const,
  message: 'You have been unsubscribed. No further alerts will be sent to that address.',
};

/**
 * Attempt the unsubscribe. The return value is for LOGGING ONLY — no caller may
 * branch its response on it.
 */
async function attempt(token: string | null): Promise<boolean> {
  if (!getCapabilities().email || !isDatabaseConfigured()) return false;

  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return false;

  const verified = verifyToken(parsed.data, 'unsubscribe');
  if (!verified.valid) {
    logger.info('alerts.unsubscribe_rejected', { reason: verified.reason });
    return false;
  }

  return unsubscribeByTokenHash(verified.tokenHash);
}

export async function GET(request: NextRequest) {
  try {
    const rate = await rateLimit('api/alerts/unsubscribe', identifierFromHeaders(request.headers));
    if (!rate.success) return tooManyRequests(rate.retryAfterSeconds);

    await attempt(request.nextUrl.searchParams.get('token'));

    // Same destination whatever happened, for the same non-enumeration reason.
    return NextResponse.redirect(alertsPageUrl('unsubscribed'), {
      status: 303,
      headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    });
  } catch (error) {
    return handleRouteError('/api/alerts/unsubscribe', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const rate = await rateLimit('api/alerts/unsubscribe', identifierFromHeaders(request.headers));
    if (!rate.success) return tooManyRequests(rate.retryAfterSeconds);

    let token = request.nextUrl.searchParams.get('token');

    if (!token) {
      // A one-click unsubscribe arrives as `List-Unsubscribe=One-Click` in a form
      // body, so both encodings have to be accepted. A malformed body is not an
      // error here — it simply yields the same success response as anything else.
      const contentType = request.headers.get('content-type') ?? '';
      try {
        if (contentType.includes('application/json')) {
          const body = (await request.json()) as { token?: unknown };
          token = typeof body.token === 'string' ? body.token : null;
        } else if (
          contentType.includes('application/x-www-form-urlencoded') ||
          contentType.includes('multipart/form-data')
        ) {
          const form = await request.formData();
          const value = form.get('token');
          token = typeof value === 'string' ? value : null;
        }
      } catch {
        token = null;
      }
    }

    await attempt(token);

    return ok(UNSUBSCRIBED, alertsResponseMeta(), NO_STORE);
  } catch (error) {
    return handleRouteError('/api/alerts/unsubscribe', error);
  }
}

/** Same behaviour as POST, for clients that model this as deleting a resource. */
export async function DELETE(request: NextRequest) {
  return POST(request);
}
