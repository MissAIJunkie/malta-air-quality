/**
 * Shared plumbing for the six scheduled jobs.
 *
 * Colocated under `/api/cron` rather than in `src/lib` because nothing outside
 * these routes uses it. Only a `route.ts` creates an endpoint, so this module is
 * inert as far as the router is concerned — the same arrangement as
 * `api/alerts/shared.ts`.
 *
 * Three things are identical for every job and are therefore not repeated in any
 * of them: the caller must be the scheduler, two invocations must not overlap,
 * and the outcome must leave one structured line in the log drain.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { getCapabilities, getEnv } from '@/config/env';
import { handleRouteError, unauthorized } from '@/lib/api/respond';
import { withLock } from '@/lib/cache/upstash';
import { logger } from '@/lib/monitoring/logger';

/**
 * Lock keys for the two jobs the cache-key registry does not cover.
 *
 * `src/lib/cache/keys.ts` predates these routes and is owned elsewhere, so the
 * strings live here instead. They follow the registry's `v1:lock:*` convention,
 * so folding them in later is a move rather than a rename.
 */
export const CRON_LOCK_KEYS = {
  generateForecasts: 'v1:lock:forecast:generate',
  cleanup: 'v1:lock:cleanup',
} as const;

/**
 * Names the refresh jobs record their reachability probes under.
 *
 * `/api/health` reads them back, so the two sides must agree. The air-quality
 * provider probes under its own `ProviderSource` name instead, because that is
 * the value the rest of the API already reports.
 */
export const PROVIDER_PROBE_NAMES = {
  weather: 'weather',
  context: 'context',
} as const;

/**
 * Whether this request carries the scheduler's credential.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`, so that is the only
 * form accepted. The `x-vercel-cron` header is deliberately NOT trusted: any
 * client can set it, and treating it as proof of origin would leave every one of
 * these endpoints publicly invocable.
 *
 * With `CRON_SECRET` unset the answer is always false. That is the opposite of
 * how the optional subsystems behave, and the difference is intentional: an
 * absent database means "skip persistence", but an absent secret cannot mean
 * "let anybody run the job".
 */
export function isAuthorisedScheduler(request: Request): boolean {
  if (!getCapabilities().cron) return false;

  const secret = getEnv().CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get('authorization');
  if (!header) return false;

  const provided = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);

  // `timingSafeEqual` throws on a length mismatch, and the length of a bearer
  // header is not itself the secret, so it is checked first.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export type CronJobResult = {
  /**
   * Set when the job deliberately did nothing because a subsystem it needs is
   * unconfigured. Not a failure — running without a database, Redis, AI or email
   * is a supported deployment mode.
   */
  skipped?: string;
  /** Counts and identifiers worth keeping. Never secrets, never addresses. */
  detail?: Record<string, unknown>;
};

export type CronJobOptions = {
  /** Stable job name. Appears in logs, in the response and in `data_import_runs`. */
  job: string;
  lockKey: string;
  /**
   * Lock lifetime. Long enough to cover the worst-case run — otherwise the next
   * invocation could overlap a slow one — and short enough that a crashed run
   * does not block the schedule for hours.
   */
  lockTtlSeconds: number;
};

type CronResponseBody = {
  job: string;
  status: 'completed' | 'skipped' | 'locked';
  note?: string;
  detail?: Record<string, unknown>;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
};

/**
 * Operational envelope.
 *
 * Deliberately NOT the `{ data, meta }` envelope from `respond.ts`. `ResponseMeta`
 * describes an air-quality payload — provider, measurement instant, freshness —
 * and a cleanup job has none of those. Filling them with placeholders to reuse
 * the shape would put fiction in every cron response.
 */
function cronResponse(body: CronResponseBody): NextResponse {
  return NextResponse.json(
    {
      ...body,
      startedAt: body.startedAt.toISOString(),
      finishedAt: body.finishedAt.toISOString(),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * Authenticate, take the lock, run the job, log the outcome.
 *
 * A thrown error becomes a 500 through `handleRouteError`, which is what makes
 * the platform record the invocation as failed instead of as a successful no-op.
 * A job that merely had nothing to do returns 200 with `status: "skipped"` and a
 * note saying why.
 */
export async function runCronJob(
  request: Request,
  options: CronJobOptions,
  work: (context: { now: Date }) => Promise<CronJobResult>,
): Promise<Response> {
  if (!isAuthorisedScheduler(request)) {
    logger.warn('cron.unauthorised', { job: options.job });
    return unauthorized();
  }

  const startedAt = new Date();

  try {
    const result = await withLock(options.lockKey, options.lockTtlSeconds, () =>
      work({ now: startedAt }),
    );

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    // `withLock` returns null ONLY when another invocation holds the lock: every
    // `work` implementation resolves to an object, so this is unambiguous.
    if (result === null) {
      logger.info('cron.locked', { job: options.job, durationMs });
      return cronResponse({
        job: options.job,
        status: 'locked',
        note: 'Another invocation of this job is still running. Nothing was done.',
        startedAt,
        finishedAt,
        durationMs,
      });
    }

    const status = result.skipped ? 'skipped' : 'completed';
    logger.info('cron.finished', {
      job: options.job,
      status,
      durationMs,
      ...(result.detail ?? {}),
    });

    return cronResponse({
      job: options.job,
      status,
      ...(result.skipped ? { note: result.skipped } : {}),
      ...(result.detail ? { detail: result.detail } : {}),
      startedAt,
      finishedAt,
      durationMs,
    });
  } catch (error) {
    return handleRouteError(`/api/cron/${options.job}`, error);
  }
}

/**
 * A short, safe description of a failure for storage in `provider_health`.
 *
 * Truncated because the column is meant to hold a message, not an upstream
 * response body, and bounded strings keep one bad day from filling the table.
 */
export function probeErrorMessage(error: unknown): string {
  return String(error).slice(0, 300);
}
