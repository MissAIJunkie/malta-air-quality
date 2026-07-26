/**
 * Plumbing shared by the three alert routes.
 *
 * Colocated here rather than in `src/lib/` because nothing outside
 * `/api/alerts/*` uses it. Not a route file — only `route.ts` creates an
 * endpoint, so this is inert as far as the router is concerned.
 */

import { getEnv } from '@/config/env';
import { findStation, type StationDefinition } from '@/config/stations';
import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import type { AirQualityCategory } from '@/config/thresholds';
import type { ResponseMeta, ProviderSource } from '@/lib/air-quality/types';
import type { EmailLinks } from '@/lib/notifications/templates';

/**
 * Where the underlying measurements come from.
 *
 * ERA's own network page, not the EEA blob the app reads: a reader following a
 * link from an email wants the original owner's public page, which is what the
 * station definitions already point at.
 */
export const SOURCE_URL = 'https://era.org.mt/topic/real-time-air-quality-network/';

/**
 * Envelope metadata for an alerts response.
 *
 * `ok()` requires a `ResponseMeta`, whose fields describe an air-quality
 * payload. These routes return no measurements, so the measurement fields are
 * null/false and `source` names the provider the alerts will be based on. Kept
 * rather than bypassed so every endpoint in the API answers with the same shape.
 */
export function alertsResponseMeta(): ResponseMeta {
  const provider = getEnv().AIR_QUALITY_PROVIDER.toUpperCase() as ProviderSource;

  return {
    source: provider,
    measuredAt: null,
    fetchedAt: new Date().toISOString(),
    nextExpectedUpdateAt: null,
    stale: false,
    partial: false,
    cached: false,
  };
}

/** Responses from these routes must never be cached — they are per-request and
 *  some carry a one-time token outcome. */
export const NO_STORE = { headers: { 'cache-control': 'no-store' } } as const;

export function appUrl(): string {
  return getEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
}

export function confirmUrl(token: string): string {
  return `${appUrl()}/api/alerts/confirm?token=${encodeURIComponent(token)}`;
}

export function unsubscribeUrl(token: string): string {
  return `${appUrl()}/api/alerts/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Where a confirm/unsubscribe click lands. The `state` param drives the message
 *  the page shows; it carries no token and is safe to share or bookmark. */
export function alertsPageUrl(state: string): string {
  return `${appUrl()}/alerts?state=${encodeURIComponent(state)}`;
}

export function buildEmailLinks(options: {
  unsubscribeToken: string;
  station?: StationDefinition | null;
}): EmailLinks {
  return {
    appUrl: appUrl(),
    detailUrl: options.station ? `${appUrl()}/stations/${options.station.slug}` : appUrl(),
    sourceUrl: options.station?.sourceUrl ?? SOURCE_URL,
    unsubscribeUrl: unsubscribeUrl(options.unsubscribeToken),
    managePreferencesUrl: `${appUrl()}/alerts`,
  };
}

/**
 * One sentence stating exactly what is being subscribed to.
 *
 * Goes in the confirmation email so consent is informed: a link that just says
 * "confirm your subscription" does not tell anyone what they are agreeing to
 * receive.
 */
export function describeSubscription(options: {
  stationId: string | null;
  pollutant: PollutantCode | null;
  thresholdCategory: AirQualityCategory | null;
  weeklySummary: boolean;
  improvementNotices: boolean;
}): string {
  const station = options.stationId ? findStation(options.stationId) : null;
  const where = station ? `${station.name} (${station.locality})` : 'anywhere in Malta and Gozo';
  const what = options.pollutant
    ? `${POLLUTANTS[options.pollutant].label} readings`
    : 'the overall air-quality band';
  const threshold = options.thresholdCategory ?? 'Poor';

  const parts = [`Alerts for ${where} when ${what} reaches ${threshold} or worse.`];
  if (options.improvementNotices) parts.push('You will also be told when it improves again.');
  if (options.weeklySummary) parts.push('Plus a weekly summary each Monday.');

  return parts.join(' ');
}
