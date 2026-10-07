/**
 * Request proxy (formerly the `middleware` file convention, renamed in Next 16).
 *
 * Two jobs: keep the JSON API out of search indexes, and mint the
 * Content-Security-Policy.
 *
 * ## Why the CSP lives here and not in `next.config.ts`
 *
 * It used to live there, with every other security header, so that exactly one
 * place decided them. That rule still holds for the rest — HSTS, frame options,
 * referrer policy and the permissions policy are all still in `next.config.ts`,
 * and nothing here duplicates them. The CSP moved because it stopped being a
 * static value.
 *
 * Google documents that AdSense supports only a strict, nonce-based CSP, and
 * says why: the domains the ad code uses change over time, so a host allowlist
 * goes stale and silently stops ads serving. A nonce has to be unpredictable and
 * unique per request, which a build-time `headers()` entry cannot produce. So
 * the policy is generated here, per request, and `next.config.ts` no longer
 * mentions it — one source of truth per header, which is what the original rule
 * was protecting.
 *
 * ## What this costs
 *
 * A per-request nonce requires dynamic rendering: the root layout reads the
 * nonce out of the request headers, which opts every route out of static
 * generation. That is cheap for this application specifically — `/` and
 * `/station/[id]` were already `force-dynamic` because they carry live
 * readings, and the remaining routes are prose with no data fetches.
 *
 * ## What cannot be verified here
 *
 * AdSense does not serve on localhost, and will not serve on this domain until
 * the account is approved, so no amount of local testing proves the ad half of
 * this policy is right. What is tested is that the site itself still works
 * under it. The script-src source list follows Google's published guidance
 * rather than our own measurement, and `'unsafe-eval'` in particular is there
 * on Google's say-so — it is a real loosening, it is theirs to require, and it
 * should be removed the moment Google's guidance stops asking for it.
 */

import { NextResponse, type NextRequest } from 'next/server';

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * The application's own subresource hosts.
 *
 * `https:` further down subsumes every one of these, so strictly they are
 * redundant. They stay because they are the record of what maqua.app itself
 * needs, as opposed to what Google's ad code needs: if the broad `https:`
 * fallbacks are ever tightened — because AdSense is dropped, or because Google
 * publishes a stable host list — these are the entries that must survive.
 */
const OPENSTREETMAP_TILES = 'https://tile.openstreetmap.org https://*.tile.openstreetmap.org';

/**
 * Build the policy for one request.
 *
 * `nonce` is minted per request by the caller and is what makes
 * `'strict-dynamic'` work: trust starts at the nonced tags we emit ourselves
 * and propagates to any script those scripts insert. That is the mechanism the
 * AdSense loader relies on to pull in its own changing hosts, and it is also
 * what lets `@vercel/analytics` and `@vercel/speed-insights` keep working —
 * both inject their script client-side from the already-trusted bundle, so
 * neither needs a nonce of its own.
 */
function contentSecurityPolicy(nonce: string): string {
  return (
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",

      /*
       * Scripts. This list is Google's, not ours.
       *
       *  - `'nonce-…'`      the only thing actually granting trust.
       *  - `'strict-dynamic'` propagates that trust to dynamically inserted
       *                     scripts, and makes browsers that support it ignore
       *                     every host-based source below.
       *  - `'unsafe-inline'` and `https:` are therefore dead weight in any modern
       *                     browser. They are Google's documented fallback for
       *                     browsers too old to understand a nonce or
       *                     `'strict-dynamic'`, where they degrade to the old
       *                     permissive behaviour instead of a blank page.
       *  - `'unsafe-eval'`  required by Google's published guidance. We cannot
       *                     confirm the ad code needs it — ads do not serve until
       *                     the account is approved — and it is the one entry here
       *                     that meaningfully weakens the policy.
       *
       * Google's example also lists `http:`. It is omitted: with
       * `upgrade-insecure-requests` below, and HSTS set in `next.config.ts`, an
       * `http://` subresource URL is rewritten to `https://` before it is ever
       * fetched, so an `http:` source expression can never match anything. Listing
       * it would imply this site loads scripts over plaintext, which it cannot.
       *
       * `'unsafe-eval'` is additionally required in development, where the bundler
       * compiles modules through eval and Fast Refresh does not work without it.
       */
      `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' 'unsafe-eval' https:`,

      /*
       * Styles, unchanged — and deliberately WITHOUT the nonce.
       *
       * A nonce in `style-src` makes browsers ignore `'unsafe-inline'`, and both
       * Radix and MapLibre set inline styles on the elements they position. Adding
       * it here would break every popover, tooltip, select and map control on the
       * site in exchange for nothing: Google asks for a nonce on scripts, not on
       * styles.
       */
      "style-src 'self' 'unsafe-inline'",

      /*
       * Images, frames and connections are widened to `https:` for the same reason
       * `script-src` is: `'strict-dynamic'` governs scripts only, and ad creatives,
       * ad iframes and measurement beacons all come from hosts Google changes
       * without notice. `frame-src` in particular has to open up — it was `'none'`,
       * and an ad renders in an iframe, so `'none'` alone would have blocked every
       * ad even with a perfect script-src.
       *
       * `frame-ancestors` stays `'none'`: this application frames ads, but nothing
       * may frame it.
       */
      `img-src 'self' data: blob: ${OPENSTREETMAP_TILES} https:`,
      "font-src 'self' data:",
      'frame-src https:',
      "frame-ancestors 'none'",
      "form-action 'self'",
      // MapLibre instantiates its worker from a blob URL.
      "worker-src 'self' blob:",
      "child-src 'self' blob: https:",
      // `ws:` in development is the Fast Refresh socket.
      `connect-src 'self' ${OPENSTREETMAP_TILES} https:${isDevelopment ? ' ws: wss:' : ''}`,
      "manifest-src 'self'",
      "media-src 'none'",

      /**
       * Production only, and deliberately so.
       *
       * This upgrades every http subresource to https. `http://localhost:3000`
       * escapes it not through a carve-out in this directive but because loopback
       * is already a potentially trustworthy origin (Secure Contexts §3.1), so
       * there is nothing insecure left to upgrade. That list is `127.0.0.0/8`,
       * `::1/128` and `localhost` — it does NOT include the RFC1918 ranges, so the
       * LAN URL `next dev` also prints, the one you open to test on a phone, is
       * ordinary insecure http. There every stylesheet, font and script is upgraded
       * to https, the dev server only speaks plain HTTP, and the page arrives with
       * no CSS at all behind a wall of ERR_SSL_PROTOCOL_ERROR.
       */
      isDevelopment ? null : 'upgrade-insecure-requests',
    ]
      // Drops the directive above when it is null, so the serialised policy never
      // contains an empty segment or a trailing separator.
      .filter(Boolean)
      .join('; ')
  );
}

export function proxy(request: NextRequest) {
  /*
   * Keep the JSON API out of search indexes.
   *
   * Without this, a crawler that finds `/api/air-quality` can index a snapshot
   * of readings and serve them from its own cache indefinitely — with no
   * measured-at, no age and no way for anyone to tell how old they are. Stale
   * readings presented as current is the one failure this project cannot
   * tolerate, so the API declines to be indexed at all.
   *
   * The API needs no CSP: it returns JSON, which executes nothing, and minting a
   * nonce for it would be ceremony. It returns early so that stays true.
   */
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const response = NextResponse.next();
    response.headers.set('x-robots-tag', 'noindex, nofollow');
    return response;
  }

  /*
   * `crypto.randomUUID()` is a v4 UUID — 122 bits of randomness from the
   * platform CSPRNG, which is well past the "unpredictable" bar a nonce has to
   * clear. Base64 because the CSP grammar's nonce-source is base64-valued.
   */
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = contentSecurityPolicy(nonce);

  /*
   * The policy goes on the REQUEST headers as well as the response, and this is
   * load-bearing rather than belt-and-braces: Next reads the nonce back out of
   * the request's own `Content-Security-Policy` to stamp its bootstrap and chunk
   * scripts. Omit it and Next emits unnonced scripts into a page whose policy
   * demands one, and every route renders blank.
   *
   * `x-nonce` is the channel the root layout reads, so the nonce can reach the
   * AdSense tag and next-themes' inline theme script.
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);

  return response;
}

export const config = {
  /*
   * Everything except the paths that are served as-is and need no policy:
   * immutable build output, optimised images, and the favicon. Prefetches from
   * `next/link` are skipped too — they fetch payloads rather than documents, and
   * minting a nonce for each would be work with nothing to show for it.
   *
   * `/api` is matched deliberately, and handled by the early return above: it is
   * where the `x-robots-tag` this file has always set is applied.
   */
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};
