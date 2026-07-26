/**
 * Consistent API envelopes and error handling.
 *
 * Every route returns `{ data, meta }` on success and `{ error }` on failure.
 * Internal detail — stack traces, upstream hostnames, credentials, prompt
 * contents — must never reach a client, so errors are mapped to a small set of
 * safe, user-comprehensible codes.
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/monitoring/logger';
import type { ResponseMeta } from '@/lib/air-quality/types';

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};

export function ok<T>(data: T, meta: ResponseMeta, init?: { headers?: Record<string, string> }) {
  return NextResponse.json(
    { data, meta },
    {
      status: 200,
      headers: {
        // Let Vercel's edge cache absorb bursts while the server keeps control
        // of how often upstream is actually queried.
        'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600',
        ...init?.headers,
      },
    },
  );
}

export function badRequest(message: string) {
  return NextResponse.json<ApiError>(
    { error: { code: 'bad_request', message } },
    { status: 400, headers: { 'cache-control': 'no-store' } },
  );
}

export function notFound(message = 'Not found') {
  return NextResponse.json<ApiError>(
    { error: { code: 'not_found', message } },
    { status: 404, headers: { 'cache-control': 'no-store' } },
  );
}

export function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json<ApiError>(
    {
      error: {
        code: 'rate_limited',
        message: 'Too many requests. Please try again shortly.',
      },
    },
    {
      status: 429,
      headers: {
        'cache-control': 'no-store',
        'retry-after': String(retryAfterSeconds),
      },
    },
  );
}

export function unauthorized() {
  return NextResponse.json<ApiError>(
    { error: { code: 'unauthorized', message: 'Unauthorized' } },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );
}

export function serviceUnavailable(message: string) {
  return NextResponse.json<ApiError>(
    { error: { code: 'upstream_unavailable', message } },
    { status: 503, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * Map an unexpected error to a safe response.
 *
 * The full error is logged server-side; the client gets a plain sentence with no
 * internal detail.
 */
export function handleRouteError(route: string, error: unknown) {
  logger.error('api.route_error', { route, error: String(error) });

  return NextResponse.json<ApiError>(
    {
      error: {
        code: 'internal_error',
        message: 'Something went wrong while preparing this response. Please try again.',
      },
    },
    { status: 500, headers: { 'cache-control': 'no-store' } },
  );
}
