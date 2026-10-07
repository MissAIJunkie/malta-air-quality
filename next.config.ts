import { networkInterfaces } from 'node:os';
import type { NextConfig } from 'next';

/**
 * Security headers.
 *
 * ## The Content-Security-Policy is NOT here
 *
 * It used to be, with everything else in this list, so that exactly one place
 * decided the security headers. It now lives in `src/proxy.ts`, and the rule it
 * was protecting is intact: each header still has exactly one source of truth,
 * and nothing in this file sets a CSP any more.
 *
 * It had to move because the policy stopped being a constant. Google documents
 * that AdSense supports only a strict, nonce-based CSP — explicitly because the
 * hosts its ad code loads from change over time, so any allowlist we wrote here
 * would go stale and quietly stop ads serving. A nonce must be unique and
 * unpredictable per request, which a static `headers()` entry cannot be.
 *
 * The reasoning that used to live here — why `'unsafe-inline'` was needed for
 * the App Router's streaming payload and the `next-themes` theme script, what
 * the map worker requires, why Vercel Analytics needs no host — has moved to
 * `src/proxy.ts` alongside the policy it explains. The nonce resolves most of
 * it: inline scripts we emit are now trusted by nonce rather than by blanket
 * `'unsafe-inline'`.
 *
 * Everything below is genuinely static and stays.
 */
const isDevelopment = process.env.NODE_ENV !== 'production';

const securityHeaders = [
  /**
   * Two years, subdomains included. `preload` is deliberately omitted: getting
   * onto the preload list is easy and getting off it is not, so it is a
   * commitment to make explicitly rather than by inheriting a snippet.
   *
   * Production only. A browser ignores an HSTS header received over plain HTTP
   * (RFC 6797 §8.1), so this never bound anything in development — but a dev
   * server has no business announcing a two-year pin, and it would start
   * binding the moment `next dev` sat behind an HTTPS proxy.
   */
  ...(isDevelopment
    ? []
    : [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains',
        },
      ]),
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    /** The full path to ourselves, the origin only to anyone else — so a station
     *  page cannot leak which station somebody was reading. */
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    /**
     * Geolocation is allowed for this origin only: "show the station nearest to
     * me" is a legitimate feature and the browser still asks first. Everything
     * else this application has no use for is denied outright.
     */
    key: 'Permissions-Policy',
    value: [
      'camera=()',
      'microphone=()',
      'geolocation=(self)',
      'payment=()',
      'usb=()',
      'midi=()',
      'magnetometer=()',
      'accelerometer=()',
      'gyroscope=()',
    ].join(', '),
  },
  {
    /** Superseded by `frame-ancestors`, kept for browsers that predate it. */
    key: 'X-Frame-Options',
    value: 'DENY',
  },
];

/**
 * This machine's own LAN addresses, so the dev server can be opened on a phone.
 *
 * Next blocks cross-origin requests to `/_next/*` in development, allowing only
 * `localhost` and the bind hostname. A same-origin `<script>` or `<link>` sends
 * no `Origin` header and slips through, but a WebSocket handshake ALWAYS sends
 * one — so opening `http://<lan-ip>:3000` gets a 403 on the HMR socket alone.
 * Under Turbopack that socket is also how the dev runtime pulls further chunks,
 * so `next/dynamic` never resolves and the map sits on its loading skeleton for
 * ever. Fast Refresh and the map both come back once the host is allowed.
 *
 * Enumerated rather than hard-coded because a DHCP lease changes, and empty
 * outside development so this can never widen anything in production.
 */
const lanDevOrigins = isDevelopment
  ? [
      ...new Set(
        Object.values(networkInterfaces())
          .flat()
          .filter(
            (iface): iface is NonNullable<typeof iface> =>
              iface !== undefined && iface.family === 'IPv4' && !iface.internal,
          )
          .map((iface) => iface.address),
      ),
    ]
  : [];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The framework version is not a secret, but announcing it in every response
  // only helps somebody scanning for a version-specific weakness.
  poweredByHeader: false,

  allowedDevOrigins: lanDevOrigins,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        /**
         * The service worker must be revalidated on every load.
         *
         * Browsers already bypass the HTTP cache for a worker script, but an
         * intermediary that cached it would pin visitors to an old offline
         * strategy — including an old idea of how to label stale readings, which
         * is the one thing it has to get right.
         */
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
