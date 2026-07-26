/**
 * Outlook assembly and driver derivation.
 *
 * Pure. `now` is a parameter, nothing here fetches, and there is no clock, no
 * randomness and — emphatically — no language model. A model may later be asked
 * to *rephrase* a driver these rules produced; it is never asked to decide that
 * one exists. The forecast itself is CAMS output surfaced unchanged; this
 * module only explains it.
 *
 * ## What a driver is, and is not
 *
 * A driver states that a condition is present alongside a modelled trend. It
 * never states that the condition will cause the trend. "Light winds may allow
 * pollutants to accumulate" is a claim about dispersion physics that holds
 * generally; "light winds will push PM10 to 60 µg/m³ on Tuesday" would be a
 * claim about a specific number nobody has verified. Only the first kind is
 * generated here.
 *
 * ## Why conjunctions
 *
 * A rising ozone forecast is mildly interesting. A rising ozone forecast under
 * a hot, lightly ventilated afternoon is the same fact with its mechanism
 * attached, and that is what a reader can act on. The rule table below is
 * therefore ordered conjunction-first, with single-condition fallbacks after
 * it, and each rule claims a topic so the same idea is never stated twice.
 */

import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import { EU_LIMIT_VALUES, categoryRank, type AirQualityCategory } from '@/config/thresholds';
import { MALTA_TIMEZONE } from '@/config/stations';
import { breakpointsFor } from '@/lib/air-quality/calculate-index';
import type { HistoricalReading, ProviderSource } from '@/lib/air-quality/types';
import type { EnrichedContextEvent, WeatherContext } from '@/lib/environmental-context/types';
import {
  assessConfidence,
  confidenceForHorizon,
  degradeConfidence,
  worstConfidence,
} from './confidence';
import {
  EXPECTED_FORECAST_HOURS,
  forecastSourceFor,
  FORECAST_METHODOLOGY,
  FORECAST_METHODOLOGY_KEY,
  type EnrichedForecastDriver,
  type ForecastSourceRef,
  type EnrichedForecastPoint,
  type ForecastConfidence,
  type ForecastDayOutlook,
  type PollutantForecastSeries,
  type StationForecastOutlook,
} from './types';

/* -------------------------------------------------------------------------- */
/*  Tuning                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Span the drivers describe.
 *
 * Drivers answer "what should I expect, and why", which is a question about the
 * next day rather than about hour 47. Longer windows dilute a real signal into
 * an average of nothing.
 */
export const DRIVER_WINDOW_HOURS = 24;

/** Trailing observed hours used as the baseline a trend is measured against. */
export const TREND_BASELINE_HOURS = 6;

/** Relative change below which a trend is treated as noise. */
export const TREND_RELATIVE_THRESHOLD = 0.2;

/** Most drivers shown. Beyond a handful, a reader stops reading. */
export const MAX_DRIVERS = 5;

/**
 * Meteorological trigger levels for the driver rules.
 *
 * Deliberately gentler than the thresholds in
 * `environmental-context/classify-event.ts`. Those decide whether a condition
 * is newsworthy on its own; these decide whether it is worth mentioning as the
 * mechanism behind a trend the forecast already shows.
 */
export const DRIVER_CONDITIONS = {
  lightWindKmh: 10,
  strongWindKmh: 38,
  shallowMixingLayerM: 300,
  meaningfulRainMm: 1,
  ozoneFavourableTemperatureC: 28,
  ozoneFavourableCloudPct: 50,
} as const;

/**
 * The ozone level at which European law requires the public to be informed.
 *
 * Derived from the thresholds table rather than written as a literal: the
 * single-reading-assessable ozone triggers are the information (180 µg/m³) and
 * alert (240 µg/m³) thresholds, and the lower of the two is the one a forecast
 * should mention. If the table changes, this follows it.
 */
const OZONE_INFORMATION_THRESHOLD = Math.min(
  ...EU_LIMIT_VALUES.filter(
    (limit) =>
      limit.pollutant === 'O3' &&
      limit.assessableFromSingleReading &&
      limit.permittedExceedances === 0,
  ).map((limit) => limit.value),
);

/**
 * Noise floor for a trend, per pollutant.
 *
 * Taken as a third of the pollutant's *Good* ceiling, so the floor scales with
 * the pollutant's own scale instead of being five separate invented numbers: a
 * 5 µg/m³ shift is a large move in PM2.5 and nothing at all in ozone.
 */
function trendNoiseFloor(pollutant: PollutantCode): number {
  return breakpointsFor(pollutant)[0].max / 3;
}

/* -------------------------------------------------------------------------- */
/*  Malta local days                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Local calendar date in Europe/Malta.
 *
 * `en-CA` is used purely because it formats as `YYYY-MM-DD`; the value is a key,
 * never displayed. Grouping by UTC day would put a 01:00 local summer hour on
 * the previous day, which is wrong on exactly the mornings people plan around.
 */
const MALTA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: MALTA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function maltaLocalDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return 'unknown';
  return MALTA_DATE.format(new Date(parsed));
}

/* -------------------------------------------------------------------------- */
/*  Trends                                                                    */
/* -------------------------------------------------------------------------- */

export type PollutantTrend = {
  pollutant: PollutantCode;
  /** Mean of the trailing observations. `null` when there is no baseline. */
  baseline: number | null;
  /** Mean of the forecast hours inside the driver window. */
  outlook: number | null;
  /** Signed change, outlook minus baseline. */
  delta: number | null;
  /** Change as a fraction of the baseline. */
  relative: number | null;
  direction: 'rising' | 'falling' | 'steady' | 'unknown';
};

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Trailing measured values for one pollutant.
 *
 * Modelled gap-fills are skipped: the baseline must be what was actually
 * measured, or the comparison becomes model-against-model and says nothing
 * about how the air is changing.
 */
function baselineValues(
  observed: HistoricalReading[],
  pollutant: PollutantCode,
  hours: number,
): number[] {
  const values: number[] = [];
  for (const reading of observed.slice(-hours)) {
    const entry = reading.pollutants[pollutant];
    if (!entry || entry.value === null || entry.modelled) continue;
    values.push(entry.value);
  }
  return values;
}

export function computeTrend(
  pollutant: PollutantCode,
  observed: HistoricalReading[],
  forecastPoints: EnrichedForecastPoint[],
): PollutantTrend {
  const baseline = mean(baselineValues(observed, pollutant, TREND_BASELINE_HOURS));
  const outlook = mean(
    forecastPoints
      .map((point) => point.predictedValue)
      .filter((value): value is number => typeof value === 'number'),
  );

  if (baseline === null || outlook === null) {
    return {
      pollutant,
      baseline,
      outlook,
      delta: null,
      relative: null,
      direction: 'unknown',
    };
  }

  const delta = outlook - baseline;
  // Guard the division: a baseline of exactly zero is a real measurement of
  // very clean air, and dividing by it would produce Infinity rather than a
  // trend.
  const relative = baseline > 0 ? delta / baseline : null;
  const floor = trendNoiseFloor(pollutant);

  const significant =
    Math.abs(delta) >= floor &&
    (relative === null || Math.abs(relative) >= TREND_RELATIVE_THRESHOLD);

  return {
    pollutant,
    baseline,
    outlook,
    delta,
    relative,
    direction: significant ? (delta > 0 ? 'rising' : 'falling') : 'steady',
  };
}

/* -------------------------------------------------------------------------- */
/*  Weather conditions inside the driver window                               */
/* -------------------------------------------------------------------------- */

export type WindowConditions = {
  from: string;
  to: string;
  minWindKmh: number | null;
  meanWindKmh: number | null;
  maxWindKmh: number | null;
  maxGustKmh: number | null;
  totalRainMm: number | null;
  maxTemperatureC: number | null;
  meanCloudCoverPct: number | null;
  minBoundaryLayerHeightM: number | null;
  /** Events whose window overlaps the driver window. */
  events: EnrichedContextEvent[];
};

function collect(values: (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

function overlapsWindow(event: EnrichedContextEvent, from: number, to: number): boolean {
  const start = event.startsAt ? Date.parse(event.startsAt) : Date.parse(event.publishedAt);
  if (!Number.isFinite(start)) return false;
  const rawEnd = event.endsAt ? Date.parse(event.endsAt) : start;
  const end = Number.isFinite(rawEnd) ? Math.max(start, rawEnd) : start;
  return start <= to && end >= from;
}

export function summariseWindow(
  from: string,
  to: string,
  weather: WeatherContext | null,
  events: EnrichedContextEvent[],
): WindowConditions {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);

  const hours = (weather?.hours ?? []).filter((hour) => {
    const t = Date.parse(hour.time);
    return Number.isFinite(t) && t >= fromMs && t <= toMs;
  });

  const winds = collect(hours.map((h) => h.windSpeedKmh));
  const gusts = collect(hours.map((h) => h.windGustKmh));
  const rain = collect(hours.map((h) => h.precipitationMm));
  const temps = collect(hours.map((h) => h.temperatureC));
  const cloud = collect(hours.map((h) => h.cloudCoverPct));
  const blh = collect(hours.map((h) => h.boundaryLayerHeightM));

  return {
    from,
    to,
    minWindKmh: winds.length > 0 ? Math.min(...winds) : null,
    meanWindKmh: mean(winds),
    maxWindKmh: winds.length > 0 ? Math.max(...winds) : null,
    maxGustKmh: gusts.length > 0 ? Math.max(...gusts) : null,
    totalRainMm: rain.length > 0 ? rain.reduce((sum, value) => sum + value, 0) : null,
    maxTemperatureC: temps.length > 0 ? Math.max(...temps) : null,
    meanCloudCoverPct: mean(cloud),
    minBoundaryLayerHeightM: blh.length > 0 ? Math.min(...blh) : null,
    events: events.filter((event) =>
      Number.isFinite(fromMs) && Number.isFinite(toMs)
        ? overlapsWindow(event, fromMs, toMs)
        : false,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/*  Drivers                                                                   */
/* -------------------------------------------------------------------------- */

/** i18n keys the driver rules can emit. Exported so the dictionary is completable. */
export const FORECAST_DRIVER_I18N_KEYS: readonly string[] = [
  'ozoneThreshold',
  'dustWithParticulates',
  'dust',
  'ozoneBuild',
  'ozoneRising',
  'poorDispersion',
  'lightWinds',
  'rainWashout',
  'rain',
  'strongWind',
  'regionalBackground',
  'improvingTrend',
  'contextEvent',
].flatMap((topic) => [`forecast.driver.${topic}.label`, `forecast.driver.${topic}.detail`]);

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export type DriverInput = {
  window: WindowConditions;
  trends: Map<PollutantCode, PollutantTrend>;
  pollutantSeries: PollutantForecastSeries[];
  /** Confidence ceiling for drivers, from the outlook's own assessment. */
  baseConfidence: ForecastConfidence;
  /**
   * Attribution for drivers derived from the forecast series itself.
   *
   * Passed in rather than hardcoded so a driver explaining fixture data cannot
   * end up citing CAMS. Drivers derived from a context event keep that event's
   * own source instead.
   */
  forecastSource: ForecastSourceRef;
};

type DriverDraft = {
  topic: string;
  label: string;
  detail: string;
  impact: EnrichedForecastDriver['impact'];
  confidence: ForecastConfidence;
  vars: Record<string, string | number>;
  sourceName: string;
  sourceUrl: string;
};

const rising = (trend: PollutantTrend | undefined) => trend?.direction === 'rising';
const falling = (trend: PollutantTrend | undefined) => trend?.direction === 'falling';

/**
 * Peak forecast concentration of one pollutant in the window.
 *
 * Used only for the ozone information-threshold note, which needs the maximum
 * rather than the mean.
 */
function peakForecastValue(
  pollutantSeries: PollutantForecastSeries[],
  pollutant: PollutantCode,
  from: string,
  to: string,
): number | null {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const series = pollutantSeries.find((entry) => entry.pollutant === pollutant);
  if (!series) return null;

  const values = series.points
    .filter((point) => {
      const t = Date.parse(point.forecastAt);
      return Number.isFinite(t) && t >= fromMs && t <= toMs;
    })
    .map((point) => point.predictedValue)
    .filter((value): value is number => typeof value === 'number');

  return values.length > 0 ? Math.max(...values) : null;
}

/**
 * Derive the drivers.
 *
 * Rules are evaluated in order and each claims a topic, so a dust plume that
 * also explains a particulate rise is stated once, with its mechanism, rather
 * than as two adjacent near-duplicates.
 */
export function deriveDrivers(input: DriverInput): EnrichedForecastDriver[] {
  const { window, trends, baseConfidence } = input;
  const drafts: DriverDraft[] = [];
  const claimed = new Set<string>();

  const add = (draft: DriverDraft) => {
    if (claimed.has(draft.topic)) return;
    claimed.add(draft.topic);
    drafts.push(draft);
  };

  const cams = {
    sourceName: input.forecastSource.name,
    sourceUrl: input.forecastSource.url,
  };

  const o3 = trends.get('O3');
  const pm10 = trends.get('PM10');
  const pm25 = trends.get('PM2.5');
  const no2 = trends.get('NO2');

  const dustEvent = window.events.find((event) => event.type === 'saharan_dust');
  const regionalEvent = window.events.find((event) => event.type === 'regional_pollution');

  /* --- Ozone approaching the public-information level --------------------- */

  const peakOzone = peakForecastValue(input.pollutantSeries, 'O3', window.from, window.to);
  if (peakOzone !== null && peakOzone >= OZONE_INFORMATION_THRESHOLD * 0.9) {
    add({
      topic: 'ozoneThreshold',
      label: 'Forecast ozone approaches the European information level',
      // Wording matters here. The information threshold is one of the few
      // levels a SINGLE hourly reading can trigger — but only an observed one.
      // A modelled hour crossing it is not an exceedance and must never be
      // described as one.
      detail: `The official forecast peaks near ${round(peakOzone)} µg/m³ of ozone, close to the European information level of ${OZONE_INFORMATION_THRESHOLD} µg/m³. This is a modelled estimate rather than a measurement, so it does not constitute an exceedance. Official information notices are issued by the authorities on the basis of measured values.`,
      impact: 'worsening',
      confidence: baseConfidence,
      vars: { peakOzone: round(peakOzone), threshold: OZONE_INFORMATION_THRESHOLD },
      ...cams,
    });
  }

  /* --- Dust ---------------------------------------------------------------- */

  if (dustEvent) {
    const particulatesRising = rising(pm10) || rising(pm25);
    const peakDust = dustEvent.vars?.peakDustUgm3;

    add({
      topic: particulatesRising ? 'dustWithParticulates' : 'dust',
      label: particulatesRising
        ? 'Saharan dust alongside a rising particulate forecast'
        : 'Saharan dust forecast over the islands',
      detail: particulatesRising
        ? `Mineral dust is forecast over the Maltese Islands${typeof peakDust === 'number' ? `, peaking near ${peakDust} µg/m³` : ''}, at the same time as the official forecast shows coarse particulate levels rising. Dust transported from North Africa may contribute to the increase.`
        : `Mineral dust is forecast over the Maltese Islands${typeof peakDust === 'number' ? `, peaking near ${peakDust} µg/m³` : ''}. Dust transported from North Africa may contribute to particulate levels, particularly PM10.`,
      impact: 'worsening',
      confidence: baseConfidence,
      vars: typeof peakDust === 'number' ? { peakDust } : {},
      sourceName: dustEvent.sourceName,
      sourceUrl: dustEvent.sourceUrl,
    });
  }

  /* --- Ozone ---------------------------------------------------------------- */

  const ozoneFavourable =
    (window.maxTemperatureC !== null &&
      window.maxTemperatureC >= DRIVER_CONDITIONS.ozoneFavourableTemperatureC) ||
    (window.meanCloudCoverPct !== null &&
      window.meanCloudCoverPct <= DRIVER_CONDITIONS.ozoneFavourableCloudPct);

  if (rising(o3) && ozoneFavourable) {
    add({
      topic: 'ozoneBuild',
      label: 'Ozone building in warm, sunny conditions',
      detail: `The official forecast has ozone averaging about ${round(o3!.outlook!)} µg/m³ over the coming day, against about ${round(o3!.baseline!)} µg/m³ in recent measurements${window.maxTemperatureC !== null ? `, with temperatures reaching around ${round(window.maxTemperatureC)} °C` : ''}. Ozone forms in sunlight rather than being emitted directly, so warm, bright and lightly ventilated conditions are likely to favour higher afternoon levels.`,
      impact: 'worsening',
      confidence: baseConfidence,
      vars: {
        outlook: round(o3!.outlook!),
        baseline: round(o3!.baseline!),
        maxTemperatureC: window.maxTemperatureC === null ? '' : round(window.maxTemperatureC),
      },
      ...cams,
    });
  } else if (rising(o3)) {
    add({
      topic: 'ozoneRising',
      label: 'Ozone forecast to rise',
      detail: `The official forecast has ozone averaging about ${round(o3!.outlook!)} µg/m³ over the coming day, against about ${round(o3!.baseline!)} µg/m³ in recent measurements. Ozone tends to peak in the afternoon.`,
      impact: 'worsening',
      confidence: baseConfidence,
      vars: { outlook: round(o3!.outlook!), baseline: round(o3!.baseline!) },
      ...cams,
    });
  }

  /* --- Dispersion ---------------------------------------------------------- */

  const poorlyVentilated =
    (window.minWindKmh !== null && window.minWindKmh <= DRIVER_CONDITIONS.lightWindKmh) ||
    (window.minBoundaryLayerHeightM !== null &&
      window.minBoundaryLayerHeightM <= DRIVER_CONDITIONS.shallowMixingLayerM);

  const localPollutantsRising = rising(no2) || rising(pm25) || rising(pm10);

  if (poorlyVentilated && localPollutantsRising) {
    add({
      topic: 'poorDispersion',
      label: 'Limited dispersion alongside a rising local forecast',
      detail: `Winds are forecast to fall to around ${window.minWindKmh === null ? 'light levels' : `${round(window.minWindKmh)} km/h`}${window.minBoundaryLayerHeightM !== null ? `, with the mixing layer shallowest at about ${round(window.minBoundaryLayerHeightM)} m` : ''}, while the official forecast shows locally emitted pollutants rising. Still air may allow traffic and combustion emissions to accumulate near the ground.`,
      impact: 'worsening',
      confidence: baseConfidence,
      vars: {
        minWindKmh: window.minWindKmh === null ? '' : round(window.minWindKmh),
        minBoundaryLayerHeightM:
          window.minBoundaryLayerHeightM === null ? '' : round(window.minBoundaryLayerHeightM),
      },
      ...cams,
    });
  } else if (window.meanWindKmh !== null && window.meanWindKmh <= DRIVER_CONDITIONS.lightWindKmh) {
    add({
      topic: 'lightWinds',
      label: 'Light winds may limit dispersion',
      detail: `Winds are forecast to average about ${round(window.meanWindKmh)} km/h. Light winds may allow locally emitted pollutants to linger rather than disperse, particularly overnight and near busy roads.`,
      impact: 'worsening',
      confidence: baseConfidence,
      vars: { meanWindKmh: round(window.meanWindKmh) },
      ...cams,
    });
  }

  /* --- Rain ---------------------------------------------------------------- */

  const meaningfulRain =
    window.totalRainMm !== null && window.totalRainMm >= DRIVER_CONDITIONS.meaningfulRainMm;

  if (meaningfulRain && (falling(pm10) || falling(pm25))) {
    add({
      topic: 'rainWashout',
      label: 'Rainfall alongside a falling particulate forecast',
      detail: `About ${round(window.totalRainMm!, 1)} mm of rain is forecast while the official forecast shows particulate levels easing. Rainfall may wash particles out of the air, and damp roads tend to lift less dust.`,
      impact: 'improving',
      confidence: baseConfidence,
      vars: { totalRainMm: round(window.totalRainMm!, 1) },
      ...cams,
    });
  } else if (meaningfulRain) {
    add({
      topic: 'rain',
      label: 'Rainfall forecast',
      detail: `About ${round(window.totalRainMm!, 1)} mm of rain is forecast. Rainfall may wash particulate matter out of the air and reduce the dust lifted by traffic.`,
      impact: 'improving',
      confidence: baseConfidence,
      vars: { totalRainMm: round(window.totalRainMm!, 1) },
      ...cams,
    });
  }

  /* --- Strong wind ---------------------------------------------------------- */

  if (window.maxWindKmh !== null && window.maxWindKmh >= DRIVER_CONDITIONS.strongWindKmh) {
    add({
      topic: 'strongWind',
      label: 'Strong winds forecast',
      detail: `Winds are forecast to reach about ${round(window.maxWindKmh)} km/h. Strong winds are likely to disperse locally emitted pollutants, though they may also raise sea salt and road dust, so the effect on particulate levels is not clear-cut.`,
      impact: 'unclear',
      confidence: baseConfidence,
      vars: { maxWindKmh: round(window.maxWindKmh) },
      ...cams,
    });
  }

  /* --- Regional background --------------------------------------------------- */

  if (regionalEvent) {
    add({
      topic: 'regionalBackground',
      label: 'Elevated regional background forecast',
      detail:
        'The regional model forecasts elevated fine particulate levels across the central Mediterranean. Pollution transported from the wider region may raise the background against which local emissions are measured.',
      impact: 'worsening',
      confidence: degradeConfidence(baseConfidence),
      vars: {},
      sourceName: regionalEvent.sourceName,
      sourceUrl: regionalEvent.sourceUrl,
    });
  }

  /* --- A clean improvement with no weather explanation ----------------------- */

  const improving = [pm10, pm25, no2, o3].find((trend) => falling(trend));
  if (improving && !claimed.has('rainWashout') && !claimed.has('rain')) {
    add({
      topic: 'improvingTrend',
      label: `${POLLUTANTS[improving.pollutant].label} forecast to ease`,
      detail: `The official forecast has ${POLLUTANTS[improving.pollutant].label} averaging about ${round(improving.outlook!)} µg/m³ over the coming day, against about ${round(improving.baseline!)} µg/m³ in recent measurements.`,
      impact: 'improving',
      confidence: baseConfidence,
      vars: {
        pollutant: POLLUTANTS[improving.pollutant].label,
        outlook: round(improving.outlook!),
        baseline: round(improving.baseline!),
      },
      ...cams,
    });
  }

  /* --- Anything else the context layer found --------------------------------- */

  for (const event of window.events) {
    if (drafts.length >= MAX_DRIVERS) break;
    if (event.type === 'saharan_dust' || event.type === 'regional_pollution') continue;
    // Meteorological events already have purpose-built rules above, driven by
    // the numbers rather than by the event's prose.
    if (
      event.type === 'low_wind' ||
      event.type === 'high_wind' ||
      event.type === 'heavy_rain' ||
      event.type === 'ozone_risk' ||
      event.type === 'temperature_inversion' ||
      event.type === 'sea_salt' ||
      event.type === 'storm' ||
      event.type === 'heatwave'
    ) {
      continue;
    }

    add({
      topic: `contextEvent:${event.type}`,
      label: event.title,
      detail: event.summary,
      impact: event.impactDirection,
      confidence: event.confidence,
      vars: {},
      sourceName: event.sourceName,
      sourceUrl: event.sourceUrl,
    });
  }

  return drafts.slice(0, MAX_DRIVERS).map((draft) => ({
    id: draft.topic,
    label: draft.label,
    detail: draft.detail,
    impact: draft.impact,
    confidence: draft.confidence,
    labelKey: `forecast.driver.${draft.topic.split(':')[0]}.label`,
    detailKey: `forecast.driver.${draft.topic.split(':')[0]}.detail`,
    vars: draft.vars,
    appliesFrom: window.from,
    appliesTo: window.to,
    sourceName: draft.sourceName,
    sourceUrl: draft.sourceUrl,
  }));
}

/* -------------------------------------------------------------------------- */
/*  Outlook assembly                                                          */
/* -------------------------------------------------------------------------- */

export type OutlookInput = {
  stationId: string;
  nowIso: string;
  /** Which provider produced the series. Decides attribution, never content. */
  provider: ProviderSource;
  basedOnObservationAt: string | null;
  observed: HistoricalReading[];
  points: EnrichedForecastPoint[];
  pollutantSeries: PollutantForecastSeries[];
  weather: WeatherContext | null;
  events: EnrichedContextEvent[];
  stationPartial: boolean;
  expectedPollutants: PollutantCode[];
  /**
   * Forecast hours the upstream actually published, before any caller-imposed
   * limit.
   *
   * Kept separate from `points.length` because confidence must describe the
   * DATA, not the request. A client asking for `?hours=6` has narrowed its own
   * view; the forecast behind it is no less certain for that, and degrading the
   * confidence would let a UI control silently rewrite a quality signal.
   * Defaults to the number of points supplied.
   */
  publishedForecastHours?: number;
};

function worsePoint(
  a: EnrichedForecastPoint | null,
  b: EnrichedForecastPoint,
): EnrichedForecastPoint | null {
  if (b.predictedCategory === null) return a;
  if (a === null || a.predictedCategory === null) return b;
  const delta = categoryRank(b.predictedCategory) - categoryRank(a.predictedCategory);
  if (delta > 0) return b;
  if (delta < 0) return a;
  return (b.predictedSubIndex ?? 0) > (a.predictedSubIndex ?? 0) ? b : a;
}

function buildDays(points: EnrichedForecastPoint[]): ForecastDayOutlook[] {
  const byDate = new Map<string, EnrichedForecastPoint[]>();

  for (const point of points) {
    const date = maltaLocalDate(point.forecastAt);
    const list = byDate.get(date) ?? [];
    list.push(point);
    byDate.set(date, list);
  }

  const days: ForecastDayOutlook[] = [];

  for (const [date, dayPoints] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let worst: EnrichedForecastPoint | null = null;
    for (const point of dayPoints) worst = worsePoint(worst, point);

    days.push({
      date,
      worstCategory: worst?.predictedCategory ?? null,
      dominantPollutant: worst?.dominantPollutant ?? null,
      peakAt: worst?.forecastAt ?? null,
      // The day is only as certain as its least certain hour.
      confidence: worstConfidence(dayPoints.map((point) => point.confidence)),
      hours: dayPoints.length,
    });
  }

  return days;
}

/**
 * Median lead time across the outlook.
 *
 * The overall confidence is assessed at the median rather than at the far end
 * or the near end. Judging a two-day outlook by its final hour would report
 * `low` for a window that is mostly well determined; judging it by its first
 * hour would report `high` for a window that is mostly not. Per-hour confidence
 * remains on every point for anyone who needs the honest detail.
 *
 * Only hours still ahead count. The published series always begins at the hour
 * after the newest measurement, which — given the roughly one-hour publication
 * lag — is usually already in the past. Including those elapsed hours would
 * drag the median towards zero and flatter the outlook.
 */
function medianHorizon(points: EnrichedForecastPoint[], nowIso: string): number | null {
  if (points.length === 0) return null;

  const nowMs = Date.parse(nowIso);
  const upcoming = Number.isFinite(nowMs)
    ? points.filter((point) => Date.parse(point.forecastAt) >= nowMs)
    : points;

  // Nothing ahead: fall back to the full set so the median is still defined.
  // `fullyElapsed` is what actually communicates the problem.
  const considered = upcoming.length > 0 ? upcoming : points;

  const leads = considered.map((point) => point.horizonHours).sort((a, b) => a - b);
  const middle = Math.floor(leads.length / 2);
  return leads.length % 2 === 0 ? (leads[middle - 1] + leads[middle]) / 2 : leads[middle];
}

/** True when no published forecast hour is still ahead of `nowIso`. */
function isFullyElapsed(points: EnrichedForecastPoint[], nowIso: string): boolean {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs) || points.length === 0) return false;
  return points.every((point) => Date.parse(point.forecastAt) < nowMs);
}

function pollutantCoverageOf(
  pollutantSeries: PollutantForecastSeries[],
  expected: PollutantCode[],
): number {
  if (expected.length === 0) return 1;
  const covered = expected.filter((code) =>
    pollutantSeries.some((series) => series.pollutant === code && series.points.length > 0),
  );
  return covered.length / expected.length;
}

/**
 * Assemble a station's outlook.
 *
 * Everything time-dependent is computed here, from `input.nowIso`, precisely so
 * that none of it can be served from a cache written an hour ago.
 */
export function buildStationOutlook(input: OutlookInput): StationForecastOutlook {
  const points = [...input.points].sort(
    (a, b) => Date.parse(a.forecastAt) - Date.parse(b.forecastAt),
  );

  const forecastSource = forecastSourceFor(input.provider);

  const common = {
    stationId: input.stationId,
    generatedAt: input.nowIso,
    basedOnObservationAt: input.basedOnObservationAt,
    methodology: FORECAST_METHODOLOGY,
    methodologyKey: FORECAST_METHODOLOGY_KEY,
    sources: [forecastSource],
    estimated: true as const,
  };

  if (points.length === 0) {
    return {
      ...common,
      horizon: null,
      points: [],
      pollutantSeries: [],
      peak: null,
      days: [],
      drivers: [],
      confidence: 'low',
      confidenceReasons: [],
      confidenceReasonKeys: [],
      available: false,
      unavailableReason:
        'No forecast hours are currently published for this station. The European feed carries a forecast only for stations that are reporting.',
      unavailableReasonKey: 'forecast.unavailable.noPublishedHours',
    };
  }

  const from = points[0].forecastAt;
  const to = points[points.length - 1].forecastAt;
  const spanHours = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 3_600_000) + 1);

  // The drivers describe at most the first day of the outlook, or the whole of
  // it when the published series is shorter than that.
  const driverWindowEndMs = Math.min(
    Date.parse(to),
    Date.parse(from) + DRIVER_WINDOW_HOURS * 3_600_000,
  );
  const driverWindowEnd = new Date(driverWindowEndMs).toISOString();

  const assessment = assessConfidence({
    horizonHours: medianHorizon(points, input.nowIso),
    availableHours: input.publishedForecastHours ?? points.length,
    expectedHours: EXPECTED_FORECAST_HOURS,
    stationPartial: input.stationPartial,
    pollutantCoverage: pollutantCoverageOf(input.pollutantSeries, input.expectedPollutants),
    fullyElapsed: isFullyElapsed(points, input.nowIso),
  });

  const trends = new Map<PollutantCode, PollutantTrend>();
  for (const series of input.pollutantSeries) {
    const inWindow = series.points.filter(
      (point) => Date.parse(point.forecastAt) <= driverWindowEndMs,
    );
    trends.set(series.pollutant, computeTrend(series.pollutant, input.observed, inWindow));
  }

  const window = summariseWindow(from, driverWindowEnd, input.weather, input.events);

  const drivers = deriveDrivers({
    window,
    trends,
    pollutantSeries: input.pollutantSeries,
    // Two ceilings, whichever is lower: a driver can never be more confident
    // than the forecast it explains, nor more confident than a statement about
    // the whole driver window deserves to be.
    baseConfidence: worstConfidence([
      assessment.confidence,
      confidenceForHorizon(DRIVER_WINDOW_HOURS),
    ]),
    forecastSource,
  });

  const withDrivers = points.map((point) => ({
    ...point,
    drivers: drivers.filter((driver) => {
      const t = Date.parse(point.forecastAt);
      return t >= Date.parse(driver.appliesFrom) && t <= Date.parse(driver.appliesTo);
    }),
  }));

  let peak: EnrichedForecastPoint | null = null;
  for (const point of withDrivers) peak = worsePoint(peak, point);

  return {
    ...common,
    horizon: { from, to, hours: spanHours },
    points: withDrivers,
    pollutantSeries: input.pollutantSeries,
    peak,
    days: buildDays(withDrivers),
    drivers,
    confidence: assessment.confidence,
    confidenceReasons: assessment.reasons,
    confidenceReasonKeys: assessment.reasonKeys,
    available: true,
  };
}

/** Convenience for a UI that wants one headline category for the whole outlook. */
export function peakCategory(outlook: StationForecastOutlook): AirQualityCategory | null {
  return outlook.peak?.predictedCategory ?? null;
}
