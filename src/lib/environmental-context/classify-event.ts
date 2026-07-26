/**
 * Deterministic event classification.
 *
 * Rules only. No AI, ever — a language model is allowed to *explain* an event
 * that these rules produced, never to decide that one exists. Every threshold
 * below is a named constant so a reader can check the reasoning, and every
 * generated sentence is hedged: these rules establish that a condition is
 * forecast, not that it caused any particular reading.
 *
 * Pure: `now` is a parameter, nothing here fetches, and the same inputs always
 * produce the same events with the same ids.
 *
 * ## What is deliberately not detected
 *
 * `wildfire_smoke` has no honest detector available here. The obvious
 * candidate — a high aerosol optical depth with low mineral dust — is also
 * consistent with sulphate haze, sea salt and continental pollution, so
 * emitting a wildfire event from it would be guessing with a citation attached.
 * `shipping_emissions` and `industrial_incident` need a feed this deployment
 * has no verified access to. All three stay in the taxonomy and are exercised
 * by the fixture provider; no live provider invents them.
 */

import type { PollutantCode } from '@/config/pollutants';
import { eventId } from './deduplicate';
import { ENVIRONMENTAL_CONTEXT_EVENT_TYPES } from './types';
import type {
  AerosolContext,
  AerosolHour,
  ContextConfidence,
  EnrichedContextEvent,
  EnvironmentalContextEventType,
  GeographicalScope,
  ImpactDirection,
  SourceRef,
  WeatherContext,
  WeatherHour,
} from './types';

/* -------------------------------------------------------------------------- */
/*  Thresholds                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every number the classifier tests against.
 *
 * Wind is in km/h to match Open-Meteo's default unit, so no conversion sits
 * between the payload and the rule. Values are chosen to fire on conditions a
 * reader would notice, not on ordinary weather: Malta is windy and hot by
 * default, and an event that is always present carries no information.
 */
export const CONTEXT_RULES = {
  lowWind: { maxSpeedKmh: 7, minHours: 3 },
  highWind: { minSpeedKmh: 38, minGustKmh: 62, minHours: 2 },
  storm: { minGustKmh: 74, rainWithGustMmPerHour: 5, rainWithGustKmh: 55, minHours: 1 },
  heavyRain: { hourlyMm: 4, windowTotalMm: 10, minHours: 1 },
  /** Above Malta's ordinary summer maximum, not merely a hot day. */
  heat: { minTemperatureC: 36, minHours: 3 },
  ozoneRisk: {
    minTemperatureC: 30,
    maxWindSpeedKmh: 15,
    maxCloudCoverPct: 35,
    /** Photochemistry needs sun: restricted to the middle of the day, UTC. */
    fromHourUtc: 8,
    toHourUtc: 16,
    minHours: 3,
  },
  /**
   * Inversion proxy, not an inversion measurement. A shallow mixing layer plus
   * air warmer at ~500 m than at the surface is the signature; confirming a
   * genuine inversion needs a radiosonde, which Malta's feed does not provide.
   */
  inversion: { maxBoundaryLayerHeightM: 250, minWarmthAloftC: 0.5, minHours: 2 },
  seaSalt: { minSpeedKmh: 30, minHours: 6 },
  saharanDust: { minDustUgm3: 20, strongDustUgm3: 50, minHours: 3 },
  regionalPollution: { minModelledPm25Ugm3: 25, maxDustUgm3: 10, minHours: 3 },
} as const;

/** Hours of model output either side of `now` the classifier considers. */
export const CLASSIFICATION_WINDOW = { pastHours: 6, futureHours: 72 } as const;

/* -------------------------------------------------------------------------- */
/*  i18n keys                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Keys the classifier emits alongside its English text.
 *
 * Exported so the dictionary can be completed without reading this file. The
 * English strings ship in the payload as well, because `t()` returns the key
 * itself when a translation is missing and a key-only payload would render
 * `context.event.low_wind.title` to a Maltese reader.
 */
export const CONTEXT_I18N_KEYS: readonly string[] = ENVIRONMENTAL_CONTEXT_EVENT_TYPES.flatMap(
  (type) => [`context.event.${type}.title`, `context.event.${type}.summary`],
);

/* -------------------------------------------------------------------------- */
/*  Sources                                                                   */
/* -------------------------------------------------------------------------- */

export const OPEN_METEO_WEATHER_SOURCE: SourceRef = {
  name: 'Open-Meteo weather forecast (ECMWF and DWD models)',
  url: 'https://open-meteo.com/',
  licence: 'CC BY 4.0',
};

export const CAMS_AEROSOL_SOURCE: SourceRef = {
  name: 'Copernicus Atmosphere Monitoring Service (CAMS), via Open-Meteo',
  url: 'https://open-meteo.com/en/docs/air-quality-api',
  licence: 'CC BY 4.0',
};

/* -------------------------------------------------------------------------- */
/*  Small pure helpers                                                        */
/* -------------------------------------------------------------------------- */

export function roundTo(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const COMPASS = [
  'northerly',
  'north-easterly',
  'easterly',
  'south-easterly',
  'southerly',
  'south-westerly',
  'westerly',
  'north-westerly',
] as const;

/** Meteorological convention: the direction the wind blows *from*. */
export function compassPoint(degrees: number | null): string | null {
  if (degrees === null || !Number.isFinite(degrees)) return null;
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return COMPASS[index];
}

export type HourRun = { from: number; to: number };

/**
 * Maximal runs of consecutive indices satisfying a predicate.
 *
 * A run is what makes a condition an *event*: one hour of light wind is noise,
 * six hours of it is a dispersion problem.
 */
export function findRuns(
  length: number,
  matches: (index: number) => boolean,
  minLength: number,
): HourRun[] {
  const runs: HourRun[] = [];
  let start: number | null = null;

  for (let i = 0; i < length; i += 1) {
    if (matches(i)) {
      if (start === null) start = i;
      continue;
    }
    if (start !== null && i - start >= minLength) runs.push({ from: start, to: i - 1 });
    if (start !== null) start = null;
  }

  if (start !== null && length - start >= minLength) runs.push({ from: start, to: length - 1 });
  return runs;
}

function statistic<T>(
  hours: T[],
  run: HourRun,
  get: (hour: T) => number | null,
  reduce: (a: number, b: number) => number,
): number | null {
  let out: number | null = null;
  for (let i = run.from; i <= run.to; i += 1) {
    const value = get(hours[i]);
    if (value === null || !Number.isFinite(value)) continue;
    out = out === null ? value : reduce(out, value);
  }
  return out;
}

const maxOf = <T>(hours: T[], run: HourRun, get: (hour: T) => number | null) =>
  statistic(hours, run, get, Math.max);
const minOf = <T>(hours: T[], run: HourRun, get: (hour: T) => number | null) =>
  statistic(hours, run, get, Math.min);
const sumOf = <T>(hours: T[], run: HourRun, get: (hour: T) => number | null) =>
  statistic(hours, run, get, (a, b) => a + b);

function runLength(run: HourRun): number {
  return run.to - run.from + 1;
}

/** Longest run, ties broken by the earliest start, so selection is stable. */
function principalRun(runs: HourRun[]): HourRun | null {
  if (runs.length === 0) return null;
  return runs.reduce((best, run) => (runLength(run) > runLength(best) ? run : best), runs[0]);
}

/**
 * Indices of the model series that fall inside the classification window.
 *
 * Returns a contiguous slice description rather than a filtered array, because
 * run detection needs the hours to stay adjacent.
 */
function windowIndices(times: string[], nowIso: string): { start: number; end: number } | null {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return null;

  const from = now - CLASSIFICATION_WINDOW.pastHours * 3_600_000;
  const to = now + CLASSIFICATION_WINDOW.futureHours * 3_600_000;

  let start = -1;
  let end = -1;
  for (let i = 0; i < times.length; i += 1) {
    const t = Date.parse(times[i]);
    if (!Number.isFinite(t) || t < from || t > to) continue;
    if (start === -1) start = i;
    end = i;
  }

  return start === -1 ? null : { start, end };
}

/* -------------------------------------------------------------------------- */
/*  Event construction                                                        */
/* -------------------------------------------------------------------------- */

type DraftEvent = {
  type: EnvironmentalContextEventType;
  title: string;
  summary: string;
  impactDirection: ImpactDirection;
  confidence: ContextConfidence;
  startsAt: string;
  endsAt: string;
  affectedPollutants?: PollutantCode[];
  geographicalScope: GeographicalScope;
  vars: Record<string, string | number>;
};

/**
 * Turn a draft into a full event.
 *
 * `publishedAt` is set to the retrieval time because neither Open-Meteo
 * response exposes its model initialisation time. That is stated rather than
 * guessed: the field means "the freshest moment we can vouch for", and
 * inventing a run time would be worse than a conservative one.
 *
 * `observedOrForecast` is always `forecast` here. Both providers serve model
 * output for past hours too, and model analysis is not observation.
 */
function toEvent(draft: DraftEvent, source: SourceRef, fetchedAt: string): EnrichedContextEvent {
  return {
    id: eventId({
      type: draft.type,
      scope: draft.geographicalScope,
      startsAt: draft.startsAt,
      sourceName: source.name,
    }),
    type: draft.type,
    title: draft.title,
    summary: draft.summary,
    impactDirection: draft.impactDirection,
    confidence: draft.confidence,
    observedOrForecast: 'forecast',
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    publishedAt: fetchedAt,
    fetchedAt,
    sourceName: source.name,
    sourceUrl: source.url,
    ...(draft.affectedPollutants ? { affectedPollutants: draft.affectedPollutants } : {}),
    geographicalScope: draft.geographicalScope,
    aiGeneratedSummary: false,
    citations: [],
    relevance: 0,
    titleKey: `context.event.${draft.type}.title`,
    summaryKey: `context.event.${draft.type}.summary`,
    vars: draft.vars,
  };
}

/* -------------------------------------------------------------------------- */
/*  Weather rules                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Meteorological events for the Maltese Islands.
 *
 * At most one event per type: the classifier reports the most sustained run of
 * each condition rather than every occurrence, because a list of nine
 * near-identical wind entries is noise, not context.
 */
export function classifyWeatherEvents(
  weather: WeatherContext,
  nowIso: string,
): EnrichedContextEvent[] {
  const hours = weather.hours;
  const bounds = windowIndices(
    hours.map((h) => h.time),
    nowIso,
  );
  if (!bounds) return [];

  const slice = hours.slice(bounds.start, bounds.end + 1);
  if (slice.length === 0) return [];

  const events: EnrichedContextEvent[] = [];
  const at = (run: HourRun) => ({ startsAt: slice[run.from].time, endsAt: slice[run.to].time });

  const push = (draft: DraftEvent) => {
    events.push(toEvent(draft, weather.source, weather.fetchedAt));
  };

  const speed = (h: WeatherHour) => h.windSpeedKmh;
  const gust = (h: WeatherHour) => h.windGustKmh;
  const rain = (h: WeatherHour) => h.precipitationMm;
  const temp = (h: WeatherHour) => h.temperatureC;

  /* --- Poor dispersion ---------------------------------------------------- */

  const lowWind = principalRun(
    findRuns(
      slice.length,
      (i) =>
        slice[i].windSpeedKmh !== null &&
        slice[i].windSpeedKmh! <= CONTEXT_RULES.lowWind.maxSpeedKmh,
      CONTEXT_RULES.lowWind.minHours,
    ),
  );
  if (lowWind) {
    const calmest = roundTo(minOf(slice, lowWind, speed) ?? 0, 1);
    const hoursCount = runLength(lowWind);
    push({
      type: 'low_wind',
      title: 'Light winds and limited dispersion',
      summary: `Wind speeds are forecast to fall to about ${calmest} km/h for around ${hoursCount} hours. Light winds may allow locally emitted pollutants — traffic nitrogen dioxide and fine particles in particular — to accumulate near the ground instead of dispersing.`,
      impactDirection: 'worsening',
      confidence: 'medium',
      affectedPollutants: ['NO2', 'PM2.5', 'PM10'],
      geographicalScope: 'Maltese Islands',
      vars: { calmestKmh: calmest, hours: hoursCount },
      ...at(lowWind),
    });
  }

  /* --- Strong wind -------------------------------------------------------- */

  const highWind = principalRun(
    findRuns(
      slice.length,
      (i) =>
        (slice[i].windSpeedKmh !== null &&
          slice[i].windSpeedKmh! >= CONTEXT_RULES.highWind.minSpeedKmh) ||
        (slice[i].windGustKmh !== null &&
          slice[i].windGustKmh! >= CONTEXT_RULES.highWind.minGustKmh),
      CONTEXT_RULES.highWind.minHours,
    ),
  );
  if (highWind) {
    const peakSpeed = roundTo(maxOf(slice, highWind, speed) ?? 0);
    const peakGust = roundTo(maxOf(slice, highWind, gust) ?? 0);
    const direction = compassPoint(slice[highWind.from].windDirectionDeg);
    push({
      type: 'high_wind',
      title: 'Strong winds forecast',
      summary: `${direction ? `${direction.charAt(0).toUpperCase()}${direction.slice(1)} winds` : 'Winds'} of around ${peakSpeed} km/h, gusting to about ${peakGust} km/h, are forecast. Strong winds are likely to disperse locally emitted pollutants, but they may also raise sea salt and resuspended road dust, so the overall effect on particulate levels is not clear-cut.`,
      // Genuinely two-sided. Reporting this as an improvement would be tidier
      // and wrong.
      impactDirection: 'unclear',
      confidence: 'medium',
      affectedPollutants: ['PM10', 'NO2'],
      geographicalScope: 'Maltese Islands',
      vars: {
        peakSpeedKmh: peakSpeed,
        peakGustKmh: peakGust,
        direction: direction ?? 'variable',
      },
      ...at(highWind),
    });
  }

  /* --- Storm -------------------------------------------------------------- */

  const storm = principalRun(
    findRuns(
      slice.length,
      (i) => {
        const g = slice[i].windGustKmh;
        const p = slice[i].precipitationMm;
        if (g !== null && g >= CONTEXT_RULES.storm.minGustKmh) return true;
        return (
          g !== null &&
          p !== null &&
          g >= CONTEXT_RULES.storm.rainWithGustKmh &&
          p >= CONTEXT_RULES.storm.rainWithGustMmPerHour
        );
      },
      CONTEXT_RULES.storm.minHours,
    ),
  );
  if (storm) {
    const peakGust = roundTo(maxOf(slice, storm, gust) ?? 0);
    push({
      type: 'storm',
      title: 'Stormy conditions forecast',
      summary: `Gusts near ${peakGust} km/h are forecast. Stormy conditions tend to clear locally emitted pollutants quickly, though sea spray and disturbed dust may briefly raise coarse particulate levels. Follow official weather warnings for safety guidance.`,
      impactDirection: 'unclear',
      confidence: 'medium',
      affectedPollutants: ['PM10'],
      geographicalScope: 'Maltese Islands',
      vars: { peakGustKmh: peakGust },
      ...at(storm),
    });
  }

  /* --- Rainfall washout --------------------------------------------------- */

  const wholeWindow: HourRun = { from: 0, to: slice.length - 1 };
  const totalRain = sumOf(slice, wholeWindow, rain) ?? 0;
  const rainRuns = findRuns(
    slice.length,
    (i) => slice[i].precipitationMm !== null && slice[i].precipitationMm! > 0,
    CONTEXT_RULES.heavyRain.minHours,
  );
  const heaviestRain = principalRun(rainRuns);
  const peakHourlyRain = heaviestRain ? (maxOf(slice, heaviestRain, rain) ?? 0) : 0;

  if (
    heaviestRain &&
    (peakHourlyRain >= CONTEXT_RULES.heavyRain.hourlyMm ||
      totalRain >= CONTEXT_RULES.heavyRain.windowTotalMm)
  ) {
    const total = roundTo(totalRain, 1);
    push({
      type: 'heavy_rain',
      title: 'Rainfall expected',
      summary: `About ${total} mm of rain is forecast over the coming days, peaking near ${roundTo(peakHourlyRain, 1)} mm in an hour. Rainfall may wash particulate matter out of the air, and damp road surfaces tend to reduce the dust lifted by traffic.`,
      impactDirection: 'improving',
      confidence: 'medium',
      affectedPollutants: ['PM10', 'PM2.5'],
      geographicalScope: 'Maltese Islands',
      vars: { totalMm: total, peakHourlyMm: roundTo(peakHourlyRain, 1) },
      ...at(heaviestRain),
    });
  }

  /* --- Heat --------------------------------------------------------------- */

  const heat = principalRun(
    findRuns(
      slice.length,
      (i) =>
        slice[i].temperatureC !== null &&
        slice[i].temperatureC! >= CONTEXT_RULES.heat.minTemperatureC,
      CONTEXT_RULES.heat.minHours,
    ),
  );
  if (heat) {
    const peakTemp = roundTo(maxOf(slice, heat, temp) ?? 0, 1);
    push({
      type: 'heatwave',
      title: 'Very high temperatures forecast',
      summary: `Temperatures are forecast to reach about ${peakTemp} °C. Sustained heat and strong sunshine are likely to favour the photochemical formation of ground-level ozone, and heat itself adds to the strain on people already sensitive to air pollution.`,
      impactDirection: 'worsening',
      confidence: 'medium',
      affectedPollutants: ['O3'],
      geographicalScope: 'Maltese Islands',
      vars: { peakTemperatureC: peakTemp },
      ...at(heat),
    });
  }

  /* --- Ozone-forming conditions ------------------------------------------- */

  const ozone = principalRun(
    findRuns(
      slice.length,
      (i) => {
        const hour = slice[i];
        const utcHour = new Date(hour.time).getUTCHours();
        if (
          utcHour < CONTEXT_RULES.ozoneRisk.fromHourUtc ||
          utcHour > CONTEXT_RULES.ozoneRisk.toHourUtc
        ) {
          return false;
        }
        return (
          hour.temperatureC !== null &&
          hour.temperatureC >= CONTEXT_RULES.ozoneRisk.minTemperatureC &&
          hour.windSpeedKmh !== null &&
          hour.windSpeedKmh <= CONTEXT_RULES.ozoneRisk.maxWindSpeedKmh &&
          hour.cloudCoverPct !== null &&
          hour.cloudCoverPct <= CONTEXT_RULES.ozoneRisk.maxCloudCoverPct
        );
      },
      CONTEXT_RULES.ozoneRisk.minHours,
    ),
  );
  if (ozone) {
    const peakTemp = roundTo(maxOf(slice, ozone, temp) ?? 0, 1);
    push({
      type: 'ozone_risk',
      title: 'Conditions that may favour ozone formation',
      summary: `Warm, sunny and lightly ventilated conditions are forecast around the middle of the day, with temperatures near ${peakTemp} °C. Ozone is formed in sunlight from other pollutants rather than emitted directly, so this combination is likely to raise afternoon ozone levels.`,
      impactDirection: 'worsening',
      confidence: 'medium',
      affectedPollutants: ['O3'],
      geographicalScope: 'Maltese Islands',
      vars: { peakTemperatureC: peakTemp },
      ...at(ozone),
    });
  }

  /* --- Inversion proxy ---------------------------------------------------- */

  const inversion = principalRun(
    findRuns(
      slice.length,
      (i) => {
        const hour = slice[i];
        if (hour.boundaryLayerHeightM === null || hour.temperature950hPaC === null) return false;
        if (hour.temperatureC === null) return false;
        return (
          hour.boundaryLayerHeightM <= CONTEXT_RULES.inversion.maxBoundaryLayerHeightM &&
          hour.temperature950hPaC - hour.temperatureC >= CONTEXT_RULES.inversion.minWarmthAloftC
        );
      },
      CONTEXT_RULES.inversion.minHours,
    ),
  );
  if (inversion) {
    const shallowest = roundTo(minOf(slice, inversion, (h) => h.boundaryLayerHeightM) ?? 0);
    push({
      type: 'temperature_inversion',
      title: 'Shallow mixing layer — possible temperature inversion',
      summary: `The forecast mixing layer drops to about ${shallowest} m with warmer air above it. That pattern is the signature of a temperature inversion, which may trap pollutants close to the ground overnight and into the early morning. This is a model-based indication rather than a measured inversion.`,
      impactDirection: 'worsening',
      // A proxy, not a sounding. Labelled low so the UI never overstates it.
      confidence: 'low',
      affectedPollutants: ['NO2', 'PM2.5', 'PM10'],
      geographicalScope: 'Maltese Islands',
      vars: { boundaryLayerHeightM: shallowest },
      ...at(inversion),
    });
  }

  /* --- Sea salt ----------------------------------------------------------- */

  const seaSalt = principalRun(
    findRuns(
      slice.length,
      (i) =>
        slice[i].windSpeedKmh !== null &&
        slice[i].windSpeedKmh! >= CONTEXT_RULES.seaSalt.minSpeedKmh,
      CONTEXT_RULES.seaSalt.minHours,
    ),
  );
  if (seaSalt) {
    const sustained = roundTo(maxOf(slice, seaSalt, speed) ?? 0);
    push({
      type: 'sea_salt',
      title: 'Sustained sea winds may lift marine aerosol',
      summary: `Winds near ${sustained} km/h are forecast to persist for around ${runLength(seaSalt)} hours. On islands this size, prolonged sea winds may add marine aerosol to measured PM10. Sea salt is a natural component of coastal particulate matter and is not a combustion pollutant.`,
      impactDirection: 'worsening',
      confidence: 'low',
      affectedPollutants: ['PM10'],
      geographicalScope: 'Maltese Islands',
      vars: { sustainedKmh: sustained, hours: runLength(seaSalt) },
      ...at(seaSalt),
    });
  }

  return events;
}

/* -------------------------------------------------------------------------- */
/*  Aerosol rules                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Aerosol events from the CAMS forecast.
 *
 * Malta sits on the main Saharan dust track into Europe, so this is the single
 * most useful piece of context the product can offer — and the one most likely
 * to be misread as an excuse for a poor reading. The wording stays hedged.
 */
export function classifyAerosolEvents(
  aerosol: AerosolContext,
  nowIso: string,
): EnrichedContextEvent[] {
  const bounds = windowIndices(
    aerosol.hours.map((h) => h.time),
    nowIso,
  );
  if (!bounds) return [];

  const slice = aerosol.hours.slice(bounds.start, bounds.end + 1);
  if (slice.length === 0) return [];

  const events: EnrichedContextEvent[] = [];
  const at = (run: HourRun) => ({ startsAt: slice[run.from].time, endsAt: slice[run.to].time });
  const dust = (h: AerosolHour) => h.dustUgm3;

  const dustRun = principalRun(
    findRuns(
      slice.length,
      (i) =>
        slice[i].dustUgm3 !== null && slice[i].dustUgm3! >= CONTEXT_RULES.saharanDust.minDustUgm3,
      CONTEXT_RULES.saharanDust.minHours,
    ),
  );

  if (dustRun) {
    const peakDust = roundTo(maxOf(slice, dustRun, dust) ?? 0);
    const strong = peakDust >= CONTEXT_RULES.saharanDust.strongDustUgm3;
    const peakAod = maxOf(slice, dustRun, (h) => h.aerosolOpticalDepth);

    events.push(
      toEvent(
        {
          type: 'saharan_dust',
          title: strong ? 'Significant Saharan dust forecast' : 'Saharan dust forecast',
          summary: `The CAMS model forecasts mineral dust concentrations peaking near ${peakDust} µg/m³ over the Maltese Islands${peakAod !== null ? `, with an aerosol optical depth of about ${roundTo(peakAod, 2)}` : ''}. Dust transported from North Africa may contribute to elevated PM10 and, to a lesser extent, PM2.5. Dust is a natural source, but the particles it adds affect health in much the same way as other coarse particulate matter.`,
          impactDirection: 'worsening',
          // Dust plumes are one of the better-predicted aerosol signals; a
          // strong, sustained forecast earns the higher confidence.
          confidence: strong ? 'high' : 'medium',
          affectedPollutants: ['PM10', 'PM2.5'],
          geographicalScope: 'Maltese Islands',
          vars: { peakDustUgm3: peakDust, hours: runLength(dustRun) },
          ...at(dustRun),
        },
        aerosol.source,
        aerosol.fetchedAt,
      ),
    );
  }

  /* --- Regional background ------------------------------------------------ */

  const regional = principalRun(
    findRuns(
      slice.length,
      (i) => {
        const hour = slice[i];
        if (hour.modelledPm25Ugm3 === null) return false;
        // Excluded when dust is doing the work: that is already reported above,
        // and reporting it twice would double-count one cause.
        if (
          hour.dustUgm3 !== null &&
          hour.dustUgm3 >= CONTEXT_RULES.regionalPollution.maxDustUgm3
        ) {
          return false;
        }
        return hour.modelledPm25Ugm3 >= CONTEXT_RULES.regionalPollution.minModelledPm25Ugm3;
      },
      CONTEXT_RULES.regionalPollution.minHours,
    ),
  );

  if (regional) {
    const peakPm25 = roundTo(maxOf(slice, regional, (h) => h.modelledPm25Ugm3) ?? 0);
    events.push(
      toEvent(
        {
          type: 'regional_pollution',
          title: 'Elevated regional background particulate forecast',
          summary: `The CAMS regional model forecasts fine particulate concentrations of about ${peakPm25} µg/m³ across the central Mediterranean, with little mineral dust. Pollution transported from the wider region may raise the background against which Malta's own emissions are measured. These are modelled regional values, not station measurements.`,
          impactDirection: 'worsening',
          confidence: 'low',
          affectedPollutants: ['PM2.5', 'PM10'],
          geographicalScope: 'Central Mediterranean',
          vars: { peakPm25Ugm3: peakPm25, hours: runLength(regional) },
          ...at(regional),
        },
        aerosol.source,
        aerosol.fetchedAt,
      ),
    );
  }

  return events;
}
