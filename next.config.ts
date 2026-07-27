import { networkInterfaces } from 'node:os';
import type { NextConfig } from 'next';

/**
 * Security headers, and a Content-Security-Policy that permits exactly what this
 * application uses.
 *
 * ## Why `'unsafe-inline'` is in `script-src`
 *
 * Not laziness — a deliberate trade, and the alternative was considered first.
 * The App Router serves its streaming payload through inline
 * `self.__next_f.push(...)` scripts, and `next-themes` injects an inline script
 * in the document head to pick the theme before first paint (without it the page
 * flashes the wrong theme on every load). A plain `script-src 'self'` blocks
 * both and the application does not render at all.
 *
 * The nonce alternative means generating a value per request in middleware and
 * threading it through the root layout. That contradicts keeping middleware free
 * of per-request work, and the theme script lives in a layout this module does
 * not control. So: `'unsafe-inline'` for inline scripts, and NO external script
 * host whatsoever. The realistic threat to a page that renders public
 * environmental data is a third-party script, and an origin allowlist of exactly
 * `'self'` is what addresses it.
 *
 * ## Map tiles
 *
 * MapLibre fetches raster tiles through its worker, so OpenStreetMap has to
 * appear in BOTH `connect-src` (the fetch) and `img-src` (the decode), and the
 * worker itself is created from a blob URL — hence `worker-src 'self' blob:`.
 * MapLibre v6 does not need `'unsafe-eval'`.
 *
 * ## Vercel Analytics and Speed Insights
 *
 * Both are served same-origin under `/_vercel/…` in production and beacon back
 * to the same place, so `'self'` already covers them. Do not add
 * `va.vercel-scripts.com`: in production nothing loads from it. In development
 * the packages fall back to a debug script on that host, which this policy
 * blocks — the resulting console message is expected, and analytics is not
 * wanted locally anyway.
 */
const isDevelopment = process.env.NODE_ENV !== 'production';

const OPENSTREETMAP_TILES = 'https://tile.openstreetmap.org https://*.tile.openstreetmap.org';

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // Nothing may frame this application, and it frames nothing.
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // `unsafe-eval` in development only: the dev bundler compiles modules through
  // eval and Fast Refresh does not work without it. It is never shipped.
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
  // Tailwind emits a stylesheet, but Radix and MapLibre both set inline styles
  // on the elements they position, which `style-src` governs.
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${OPENSTREETMAP_TILES}`,
  "font-src 'self' data:",
  // MapLibre instantiates its worker from a blob URL.
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  // `ws:` in development is the Fast Refresh socket.
  `connect-src 'self' ${OPENSTREETMAP_TILES}${isDevelopment ? ' ws: wss:' : ''}`,
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
  .join('; ');

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: contentSecurityPolicy,
  },
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
