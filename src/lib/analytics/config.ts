/**
 * Analytics configuration.
 *
 * Deliberately separate from `src/config/env.ts`, which is server-side and
 * Zod-validated. These flags have to be legible in the browser bundle, and Next
 * only inlines a `NEXT_PUBLIC_*` variable when it appears as a complete static
 * member expression — `process.env[name]` would silently evaluate to
 * `undefined` in the client. Each one is therefore written out in full.
 *
 * Both products are OFF unless explicitly enabled. Neither is required for the
 * application to work, and a deployment that sets nothing ships no analytics at
 * all, which is what the privacy page promises.
 */

/** `true` and `1` enable; anything else — including absent — does not. */
function flag(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

export const analyticsEnabled = flag(process.env.NEXT_PUBLIC_VERCEL_ANALYTICS_ENABLED);

export const speedInsightsEnabled = flag(process.env.NEXT_PUBLIC_VERCEL_SPEED_INSIGHTS_ENABLED);

/** True when any measurement runs at all. The privacy page reads this. */
export const anyAnalyticsEnabled = analyticsEnabled || speedInsightsEnabled;

const FALLBACK_SITE_URL = 'https://maqua.app';

/**
 * Canonical origin.
 *
 * Used for `metadataBase`, canonical links, the sitemap and robots. It falls
 * back to the production origin rather than to a relative URL, because a
 * `metadataBase` that is absent makes Next emit relative Open Graph URLs, which
 * most crawlers discard.
 *
 * The value is PARSED before it is accepted, and anything unusable is replaced
 * rather than propagated. The root layout passes this to `new URL()` at module
 * scope, which is above every error boundary — including `global-error.tsx`,
 * since the throw happens while the layout module is being evaluated rather than
 * while it renders. A deployment that sets `NEXT_PUBLIC_APP_URL=` to an empty
 * string, or to `maqua.app` without a scheme, would otherwise take the whole
 * application down at boot over a cosmetic setting. `??` alone does not cover
 * this: an empty string is not nullish and passes straight through.
 */
function resolveSiteUrl(raw: string | undefined): string {
  const candidate = raw?.trim();
  if (!candidate) return FALLBACK_SITE_URL;

  try {
    const parsed = new URL(candidate);
    // Only http(s). A `file:` or `javascript:` origin parses successfully and
    // would then be emitted into canonical links and the sitemap.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return FALLBACK_SITE_URL;
    return parsed.origin;
  } catch {
    return FALLBACK_SITE_URL;
  }
}

export const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_APP_URL);

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path = '/'): string {
  return `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
