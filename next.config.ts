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
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: contentSecurityPolicy,
  },
  {
    /**
     * Two years, subdomains included. `preload` is deliberately omitted: getting
     * onto the preload list is easy and getting off it is not, so it is a
     * commitment to make explicitly rather than by inheriting a snippet.
     */
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The framework version is not a secret, but announcing it in every response
  // only helps somebody scanning for a version-specific weakness.
  poweredByHeader: false,

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
