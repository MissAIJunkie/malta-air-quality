/**
 * Environmental-context fixture provider.
 *
 * Selected with `WEATHER_PROVIDER=fixture`. Never a silent fallback for a
 * failing live provider: a provider outage yields an empty list, because
 * inventing weather would be exactly the fabrication this module forbids.
 *
 * The synthetic series is deliberately run through the REAL classifiers rather
 * than shipping a hand-written list of events. That keeps `classify-event.ts`
 * exercised in development and in CI, and it means a threshold change shows up
 * in the fixture immediately instead of drifting away from it. The series is
 * shaped to cross four thresholds on purpose — a calm night, a warm sunny
 * middle of the day, a shallow nocturnal mixing layer, and a dust plume
 * arriving the following evening.
 *
 * Three event types have no detector at all (`wildfire_smoke`,
 * `shipping_emissions`, `industrial_incident` — see `classify-event.ts`). Those
 * are supplied as explicit fixtures so their rendering paths exist.
 *
 * EVERY event produced here — classified or hand-written — cites
 * `FIXTURE_SOURCE`. The synthetic series therefore carries a fixture source ref
 * rather than Open-Meteo's or CAMS's, because the classifiers copy the series'
 * source onto each event they emit. Naming a real organisation beside invented
 * numbers would be a false provenance claim that outlives the response: it
 * survives into screenshots, logs and AI prompts, none of which carry
 * `meta.source` alongside to correct it.
 */

import { MALTA_CENTRE } from '@/config/stations';
import { classifyAerosolEvents, classifyWeatherEvents } from '../classify-event';
import { eventId } from '../deduplicate';
import type {
  AerosolContext,
  AerosolHour,
  EnrichedContextEvent,
  SourceRef,
  WeatherContext,
  WeatherHour,
} from '../types';

const [longitude, latitude] = MALTA_CENTRE;

/** Hours of synthetic series, starting six hours before the current hour. */
const PAST_HOURS = 6;
const FUTURE_HOURS = 72;

/**
 * Source for the hand-written fixtures.
 *
 * Named so it can never be mistaken for a real report if it leaks into a
 * screenshot, a log line or an AI prompt.
 */
export const FIXTURE_SOURCE: SourceRef = {
  name: 'maqua.app development fixture — not a real report',
  url: 'https://maqua.app/',
  licence: 'Sample data',
};

function currentHourMs(): number {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return now.getTime();
}

/** Smooth diurnal curve peaking at 13:00 UTC, in [0, 1]. */
function diurnal(utcHour: number): number {
  return (1 + Math.sin(((utcHour - 7) / 24) * 2 * Math.PI)) / 2;
}

function isNight(utcHour: number): boolean {
  return utcHour >= 20 || utcHour <= 5;
}

export function buildFixtureWeather(): WeatherContext {
  const anchor = currentHourMs() - PAST_HOURS * 3_600_000;
  const hours: WeatherHour[] = [];

  for (let i = 0; i < PAST_HOURS + FUTURE_HOURS; i += 1) {
    const ms = anchor + i * 3_600_000;
    const time = new Date(ms).toISOString();
    const utcHour = new Date(ms).getUTCHours();
    const night = isNight(utcHour);

    const temperatureC = Math.round((22 + 11 * diurnal(utcHour)) * 10) / 10;

    hours.push({
      time,
      temperatureC,
      relativeHumidityPct: night ? 78 : 52,
      dewPointC: Math.round((temperatureC - (night ? 4 : 11)) * 10) / 10,
      precipitationMm: 0,
      // Calm at night (trips the low-wind rule), light by day (leaves the
      // ozone rule's ventilation condition satisfied).
      windSpeedKmh: night ? 5 : 12,
      windDirectionDeg: night ? 320 : 160,
      windGustKmh: night ? 11 : 24,
      boundaryLayerHeightM: night ? 190 : 1250,
      surfacePressureHpa: 1013,
      cloudCoverPct: night ? 20 : 10,
      // Warmer aloft than at the surface overnight — the inversion signature.
      temperature950hPaC: night ? temperatureC + 1.8 : temperatureC - 4,
    });
  }

  return {
    fetchedAt: new Date().toISOString(),
    latitude,
    longitude,
    hours,
    source: FIXTURE_SOURCE,
  };
}

export function buildFixtureAerosol(): AerosolContext {
  const anchor = currentHourMs() - PAST_HOURS * 3_600_000;
  const hours: AerosolHour[] = [];

  // A plume arriving tomorrow evening and clearing overnight.
  const plumeFrom = PAST_HOURS + 18;
  const plumeTo = PAST_HOURS + 30;

  for (let i = 0; i < PAST_HOURS + FUTURE_HOURS; i += 1) {
    const ms = anchor + i * 3_600_000;
    const utcHour = new Date(ms).getUTCHours();

    const inPlume = i >= plumeFrom && i <= plumeTo;
    const plumeShape = inPlume ? Math.sin(((i - plumeFrom) / (plumeTo - plumeFrom)) * Math.PI) : 0;

    const dustUgm3 = Math.round(3 + 62 * plumeShape);

    hours.push({
      time: new Date(ms).toISOString(),
      dustUgm3,
      modelledPm10Ugm3: Math.round(18 + dustUgm3 * 0.8),
      modelledPm25Ugm3: Math.round(11 + dustUgm3 * 0.15),
      aerosolOpticalDepth: Math.round((0.28 + 0.45 * plumeShape) * 100) / 100,
      uvIndex: Math.round(9 * diurnal(utcHour) * 10) / 10,
    });
  }

  return {
    fetchedAt: new Date().toISOString(),
    latitude,
    longitude,
    hours,
    source: FIXTURE_SOURCE,
  };
}

/**
 * Events for types no live detector produces.
 *
 * Windows are anchored to the current hour so they always sit inside the
 * classification window and the UI has something to render, while remaining
 * fully deterministic for a given hour.
 */
function handWrittenEvents(nowIso: string): EnrichedContextEvent[] {
  const base = currentHourMs();
  const iso = (offsetHours: number) => new Date(base + offsetHours * 3_600_000).toISOString();

  const drafts = [
    {
      type: 'wildfire_smoke' as const,
      title: 'Smoke plume reported over the central Mediterranean',
      summary:
        'A smoke plume from vegetation fires is reported drifting across the central Mediterranean. Smoke may contribute to elevated fine particulate levels if it reaches the islands, though its track is uncertain.',
      impactDirection: 'worsening' as const,
      confidence: 'low' as const,
      observedOrForecast: 'forecast' as const,
      startsAt: iso(12),
      endsAt: iso(36),
      affectedPollutants: ['PM2.5' as const, 'PM10' as const],
      geographicalScope: 'Central Mediterranean' as const,
    },
    {
      type: 'shipping_emissions' as const,
      title: 'Heavy vessel movements in the Grand Harbour area',
      summary:
        'An unusually busy period of vessel movements is reported around the harbours. Shipping emissions may contribute to sulphur dioxide and nitrogen dioxide levels near the coast when winds are light.',
      impactDirection: 'worsening' as const,
      confidence: 'low' as const,
      observedOrForecast: 'observed' as const,
      startsAt: iso(-3),
      endsAt: iso(9),
      affectedPollutants: ['SO2' as const, 'NO2' as const],
      geographicalScope: 'Malta' as const,
    },
    {
      type: 'industrial_incident' as const,
      title: 'Localised industrial release reported',
      summary:
        'A short-lived industrial release has been reported. Effects, if any, are likely to be confined to the immediate area and to a few hours. Follow official guidance from the authorities for any advice on precautions.',
      impactDirection: 'worsening' as const,
      confidence: 'low' as const,
      observedOrForecast: 'observed' as const,
      startsAt: iso(-2),
      endsAt: iso(2),
      affectedPollutants: ['SO2' as const],
      geographicalScope: 'Malta' as const,
    },
  ];

  return drafts.map((draft) => ({
    id: eventId({
      type: draft.type,
      scope: draft.geographicalScope,
      startsAt: draft.startsAt,
      sourceName: FIXTURE_SOURCE.name,
    }),
    type: draft.type,
    title: draft.title,
    summary: draft.summary,
    impactDirection: draft.impactDirection,
    confidence: draft.confidence,
    observedOrForecast: draft.observedOrForecast,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    publishedAt: nowIso,
    fetchedAt: nowIso,
    sourceName: FIXTURE_SOURCE.name,
    sourceUrl: FIXTURE_SOURCE.url,
    affectedPollutants: draft.affectedPollutants,
    geographicalScope: draft.geographicalScope,
    aiGeneratedSummary: false,
    citations: [],
    relevance: 0,
    titleKey: `context.event.${draft.type}.title`,
    summaryKey: `context.event.${draft.type}.summary`,
    vars: {},
  }));
}

export function buildFixtureEvents(nowIso: string): EnrichedContextEvent[] {
  return [
    ...classifyWeatherEvents(buildFixtureWeather(), nowIso),
    ...classifyAerosolEvents(buildFixtureAerosol(), nowIso),
    ...handWrittenEvents(nowIso),
  ];
}

export const fixtureContextProvider = {
  name: 'FIXTURE' as const,
  source: FIXTURE_SOURCE,
  fetchWeather: async (): Promise<WeatherContext> => buildFixtureWeather(),
  fetchAerosol: async (): Promise<AerosolContext> => buildFixtureAerosol(),
  buildEvents: buildFixtureEvents,
};
