/**
 * Analytics mounting point.
 *
 * A single component so the root layout does not have to know which products
 * exist or how each one is gated. Nothing renders unless the corresponding
 * `NEXT_PUBLIC_*` flag is on, so a default deployment loads no measurement
 * script whatsoever.
 *
 * Both Vercel components are cookieless and record page views and Web Vitals,
 * not people. That claim is repeated on /privacy, so if this file ever gains a
 * product that behaves differently, /privacy must change in the same commit.
 */

import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

import { analyticsEnabled, speedInsightsEnabled } from './config';

export function AnalyticsScripts() {
  return (
    <>
      {analyticsEnabled ? <Analytics /> : null}
      {speedInsightsEnabled ? <SpeedInsights /> : null}
    </>
  );
}

export {
  absoluteUrl,
  analyticsEnabled,
  anyAnalyticsEnabled,
  siteUrl,
  speedInsightsEnabled,
} from './config';
