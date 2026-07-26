/**
 * ERA direct provider — DOCUMENTED BUT UNVERIFIED.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  Read this before enabling it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Malta's Environment and Resources Authority operates all five monitoring
 * stations and is the authoritative source for official Maltese air-quality
 * data. maqua.app would prefer to read from ERA directly.
 *
 * It cannot, and this file does not pretend otherwise.
 *
 * Every probe of `era.org.mt` from the build environment on 2026-07-26 returned
 * HTTP 403 behind Cloudflare bot protection — the topic page, the widget page,
 * and even static `wp-content` PDF assets. No JSON, CSV, or other structured
 * endpoint was ever observed.
 *
 * Consequently there is NO endpoint URL written here. Inventing a plausible one
 * would violate the project's own rule against fabricating API endpoints, and
 * would produce a provider that appears to work while silently returning
 * nothing. The class below refuses to run unless an operator supplies a real,
 * verified URL via `ERA_AIR_QUALITY_URL`.
 *
 * The ERA-operated measurements DO reach maqua.app — reported by Malta under
 * Directive 2008/50/EC and disseminated through the EEA. See `eea-provider.ts`
 * and docs/DATA_SOURCE.md §2.
 *
 * To complete this provider you need: the endpoint URL, its response shape, its
 * station identifiers, and its update cadence. Add a Zod schema to `schemas.ts`,
 * normalise into `StationReading`, and add `era.org.mt` paths to the allowlist
 * (the host is already permitted).
 */

import { getEnv } from '@/config/env';
import type {
  AirQualityProvider,
  AirQualityStation,
  StationReading,
} from '../types';

export class EraProviderNotConfiguredError extends Error {
  constructor() {
    super(
      'The ERA provider has no verified endpoint. era.org.mt returned HTTP 403 to every ' +
        'probe from the build environment, so no endpoint was ever observed and none has ' +
        'been invented. Set AIR_QUALITY_PROVIDER=eea (the default) to use ERA measurements ' +
        'as disseminated by the EEA. See docs/DATA_SOURCE.md §2.',
    );
    this.name = 'EraProviderNotConfiguredError';
  }
}

export class EraAirQualityProvider implements AirQualityProvider {
  readonly name = 'ERA' as const;

  private assertConfigured(): never | void {
    if (!getEnv().ERA_AIR_QUALITY_URL) throw new EraProviderNotConfiguredError();
  }

  async getStations(): Promise<AirQualityStation[]> {
    this.assertConfigured();
    // Reached only once ERA_AIR_QUALITY_URL is set, which requires a verified
    // endpoint and the parsing work described above.
    throw new EraProviderNotConfiguredError();
  }

  async getLatestReadings(): Promise<StationReading[]> {
    this.assertConfigured();
    throw new EraProviderNotConfiguredError();
  }
}

export const eraProvider = new EraAirQualityProvider();
