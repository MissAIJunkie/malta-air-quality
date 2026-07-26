/**
 * Request proxy (formerly the `middleware` file convention, renamed in Next 16).
 *
 * Deliberately almost empty. Security headers, including the Content-Security-
 * Policy, are set in `next.config.ts` so there is exactly one place that decides
 * them; duplicating any of them here would create two sources of truth and a
 * class of bug where the answer depends on which layer ran last.
 *
 * This file also imports nothing from the project. The proxy runs on the edge
 * runtime for every matched request, and pulling in the service layer, the
 * database client or the environment parser would put Node-only code on that
 * path and add latency to requests that need none of it.
 */

import { NextResponse } from 'next/server';

export function proxy() {
  const response = NextResponse.next();

  /*
   * Keep the JSON API out of search indexes.
   *
   * Without this, a crawler that finds `/api/air-quality` can index a snapshot
   * of readings and serve them from its own cache indefinitely — with no
   * measured-at, no age and no way for anyone to tell how old they are. Stale
   * readings presented as current is the one failure this project cannot
   * tolerate, so the API declines to be indexed at all.
   */
  response.headers.set('x-robots-tag', 'noindex, nofollow');

  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
