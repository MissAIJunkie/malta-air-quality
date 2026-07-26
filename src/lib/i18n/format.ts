/**
 * Formatting helpers.
 *
 * Two rules drive everything here.
 *
 * 1. Times are always Malta wall-clock time, never the server's and never the
 *    browser's. A reading is meaningful only against the hour it was taken in
 *    the place it was taken.
 * 2. A missing value is never rendered as a number. `formatConcentration(null)`
 *    returns the "Not available" marker; it must never return "0".
 *
 * Locales are pinned rather than taken from the runtime, because
 * `Intl.NumberFormat(undefined)` resolves differently on the server and in the
 * browser and would produce hydration mismatches.
 */

import { format as formatDate } from 'date-fns';

import { MALTA_TIMEZONE } from '@/config/stations';
import { getDictionary, t, type Dictionary } from './dictionary';

/* -------------------------------------------------------------------------- */
/*  Europe/Malta wall clock                                                   */
/* -------------------------------------------------------------------------- */

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * `h23` rather than `hour12: false`: some engines render midnight as "24" under
 * `hour12: false`, which would put the date and the hour a day apart.
 */
const MALTA_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: MALTA_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function wallClockOf(epochMs: number): WallClock | null {
  if (!Number.isFinite(epochMs)) return null;

  const parts = MALTA_PARTS.formatToParts(new Date(epochMs));
  const found: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') found[part.type] = part.value;
  }

  const wall: WallClock = {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour),
    minute: Number(found.minute),
    second: Number(found.second),
  };

  return Object.values(wall).every(Number.isFinite) ? wall : null;
}

function toEpochMs(value: Date | number | string): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return Date.parse(value);
}

const MS_PER_MINUTE = 60_000;

/**
 * A `Date` whose *local* accessors report Europe/Malta.
 *
 * This is the same trick `@date-fns/tz`'s `TZDate` uses, reimplemented here
 * because that package is not a dependency. date-fns builds every formatted
 * token from `getFullYear`/`getMonth`/`getDate`/`getDay`/`getHours`/
 * `getMinutes`/`getSeconds`/`getTimezoneOffset`, and `toDate` clones a date via
 * `new date.constructor(value)` — so overriding those accessors is enough to
 * make the whole of `format()` speak Malta time, on any host, with DST handled
 * by the platform's own tz database.
 *
 * The alternative — rebuilding a Date from local-time components — silently
 * shifts by an hour whenever the target wall-clock time falls inside the HOST's
 * daylight-saving gap. That is a once-a-year, wrong-by-an-hour bug that would
 * only ever be seen in production, so it is avoided rather than accepted.
 *
 * Read-only: the `set*` mutators are inherited and still operate in the host
 * zone, so do not mutate a `MaltaDate`. Construct a new one instead.
 */
export class MaltaDate extends Date {
  private wallCache: { at: number; wall: WallClock | null } | null = null;

  constructor(value: Date | number | string = Date.now()) {
    super(toEpochMs(value));
  }

  private wall(): WallClock | null {
    const at = super.getTime();
    if (!this.wallCache || this.wallCache.at !== at) {
      this.wallCache = { at, wall: wallClockOf(at) };
    }
    return this.wallCache.wall;
  }

  override getFullYear(): number {
    return this.wall()?.year ?? NaN;
  }

  override getMonth(): number {
    const wall = this.wall();
    return wall ? wall.month - 1 : NaN;
  }

  override getDate(): number {
    return this.wall()?.day ?? NaN;
  }

  override getDay(): number {
    const wall = this.wall();
    if (!wall) return NaN;
    // Day-of-week from the Malta calendar date, computed in UTC so the host
    // zone cannot roll it over a boundary.
    return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  }

  override getHours(): number {
    return this.wall()?.hour ?? NaN;
  }

  override getMinutes(): number {
    return this.wall()?.minute ?? NaN;
  }

  override getSeconds(): number {
    return this.wall()?.second ?? NaN;
  }

  override getMilliseconds(): number {
    // Sub-second precision is the same in every zone.
    return super.getUTCMilliseconds();
  }

  /** Minutes behind UTC, matching `Date`'s sign convention (Malta: −60 or −120). */
  override getTimezoneOffset(): number {
    const wall = this.wall();
    if (!wall) return NaN;
    const wallAsUtc = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
    const secondAligned = Math.floor(super.getTime() / 1000) * 1000;
    return -(wallAsUtc - secondAligned) / MS_PER_MINUTE;
  }
}

/** Parse anything date-like into a Malta-zoned date. `null` when unusable. */
export function toMaltaDate(value: string | number | Date | null | undefined): MaltaDate | null {
  if (value === null || value === undefined) return null;
  const ms = toEpochMs(value);
  if (!Number.isFinite(ms)) return null;
  return new MaltaDate(ms);
}

/* -------------------------------------------------------------------------- */
/*  Patterns                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Shared date-fns patterns, so every surface renders a timestamp the same way.
 * 24-hour throughout: Malta uses it, and it removes am/pm ambiguity at 12:00.
 */
export const DATE_PATTERNS = {
  /** 14:00 */
  time: 'HH:mm',
  /** 26 Jul */
  date: 'd MMM',
  /** 26 July 2026 */
  dateLong: 'd MMMM yyyy',
  /** Sun 26 Jul, 14:00 */
  dateTime: 'EEE d MMM, HH:mm',
  /** Sunday 26 July 2026 at 14:00 */
  dateTimeLong: "EEEE d MMMM yyyy 'at' HH:mm",
  /** Sun 14:00 — for dense chart axes */
  axisDayTime: 'EEE HH:mm',
  /** 2026-07-26 14:00 */
  numeric: 'yyyy-MM-dd HH:mm',
} as const;

/* -------------------------------------------------------------------------- */
/*  Time formatting                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Format an instant in Malta time using a date-fns pattern.
 *
 * Returns the "Not available" marker rather than throwing or printing
 * "Invalid Date" when the input cannot be parsed.
 */
export function formatInMalta(
  iso: string | number | Date | null | undefined,
  pattern: string = DATE_PATTERNS.dateTime,
  dict: Dictionary = getDictionary(),
): string {
  const date = toMaltaDate(iso);
  if (!date) return notAvailable(dict);
  return formatDate(date, pattern);
}

/** 14:00 */
export function formatTimeInMalta(
  iso: string | number | Date | null | undefined,
  dict: Dictionary = getDictionary(),
): string {
  return formatInMalta(iso, DATE_PATTERNS.time, dict);
}

/** 26 July 2026 */
export function formatDateInMalta(
  iso: string | number | Date | null | undefined,
  dict: Dictionary = getDictionary(),
): string {
  return formatInMalta(iso, DATE_PATTERNS.dateLong, dict);
}

/**
 * The standard rendering of a measurement instant: "Sun 26 Jul, 14:00".
 *
 * Always pair this with the age or the freshness state. A timestamp on its own
 * does not tell a reader whether the value is current.
 */
export function formatMeasuredAt(
  iso: string | null | undefined,
  dict: Dictionary = getDictionary(),
): string {
  return formatInMalta(iso, DATE_PATTERNS.dateTime, dict);
}

/** "Sunday 26 July 2026 at 14:00 (Malta time)" — for tooltips and detail rows. */
export function formatMeasuredAtLong(
  iso: string | null | undefined,
  dict: Dictionary = getDictionary(),
): string {
  const rendered = formatInMalta(iso, DATE_PATTERNS.dateTimeLong, dict);
  if (rendered === notAvailable(dict)) return rendered;
  return `${rendered} (${t(dict, 'time.maltaTime')})`;
}

/**
 * Machine-readable value for the `datetime` attribute of `<time>`.
 *
 * Deliberately the UTC instant, not the Malta wall clock: assistive technology
 * and crawlers want the unambiguous instant, while humans read the Malta time
 * next to it.
 */
export function toDateTimeAttribute(iso: string | null | undefined): string | undefined {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/* -------------------------------------------------------------------------- */
/*  Age                                                                       */
/* -------------------------------------------------------------------------- */

const HOURS_PER_DAY = 24;

/**
 * Render an age in whole hours, as produced by `ageInHours()`.
 *
 * `0` means "under an hour old", NOT "no time has passed" — `ageInHours` floors.
 * Rendering it as "0 hours old" would read as a precision the data does not
 * have, so it becomes "Less than an hour old".
 *
 * Negative ages are legitimate: forecast points sit ahead of now.
 */
export function formatRelativeAge(
  hours: number | null | undefined,
  dict: Dictionary = getDictionary(),
): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) {
    return t(dict, 'time.ageUnknown');
  }

  if (hours < 0) {
    const ahead = Math.abs(hours);
    if (ahead < 1) return t(dict, 'time.inLessThanAnHour');
    if (ahead < 2) return t(dict, 'time.inAnHour');
    return t(dict, 'time.inHours', { count: Math.round(ahead) });
  }

  const whole = Math.floor(hours);
  if (whole < 1) return t(dict, 'time.lessThanAnHour');
  if (whole === 1) return t(dict, 'time.hourAgo');
  if (whole < HOURS_PER_DAY) return t(dict, 'time.hoursAgo', { count: whole });

  const days = Math.floor(whole / HOURS_PER_DAY);
  if (days === 1) return t(dict, 'time.dayAgo');
  return t(dict, 'time.daysAgo', { count: days });
}

/* -------------------------------------------------------------------------- */
/*  Numbers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The i18n key for the unavailable marker.
 *
 * Compare against this key (or use `isUnavailableText`) rather than
 * string-matching "Not available", which changes with the locale.
 */
export const NOT_AVAILABLE_KEY = 'common.notAvailable';

export function notAvailable(dict: Dictionary = getDictionary()): string {
  return t(dict, NOT_AVAILABLE_KEY);
}

export function isUnavailableText(text: string, dict: Dictionary = getDictionary()): boolean {
  return text === notAvailable(dict);
}

/** Pinned so server and client render identically. */
const NUMBER_LOCALE = 'en-GB';

function numberFormatter(fractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * Significant figures for a concentration.
 *
 * Below 10 µg/m³ one decimal carries real information; above it the instrument
 * precision does not justify decimals, and whole numbers match how the index
 * bands are defined.
 */
function concentrationFractionDigits(value: number): number {
  return Math.abs(value) < 10 ? 1 : 0;
}

export function formatNumber(
  value: number | null | undefined,
  fractionDigits = 0,
  dict: Dictionary = getDictionary(),
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return notAvailable(dict);
  return numberFormatter(fractionDigits).format(value);
}

/**
 * Structured concentration output, so callers can style the number and the unit
 * separately and can branch on availability without matching strings.
 */
export type ConcentrationParts = {
  available: boolean;
  /** The number alone, or the unavailable marker. */
  value: string;
  /** Empty string when unavailable — a unit without a value is meaningless. */
  unit: string;
  /** Ready-to-render combination of the two. */
  text: string;
};

export function formatConcentrationParts(
  value: number | null | undefined,
  unit: string,
  dict: Dictionary = getDictionary(),
): ConcentrationParts {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    const marker = notAvailable(dict);
    return { available: false, value: marker, unit: '', text: marker };
  }

  const rendered = numberFormatter(concentrationFractionDigits(value)).format(value);
  // Non-breaking space: a unit must never wrap away from its number.
  return { available: true, value: rendered, unit, text: `${rendered} ${unit}` };
}

/**
 * Format a concentration with its unit.
 *
 * `null` means the instrument reported nothing for that hour. It renders as
 * "Not available" and MUST NOT be shown as 0 — zero is a measurement claim.
 */
export function formatConcentration(
  value: number | null | undefined,
  unit: string,
  dict: Dictionary = getDictionary(),
): string {
  return formatConcentrationParts(value, unit, dict).text;
}

/** Continuous sub-index, e.g. "3.4". */
export function formatSubIndex(
  value: number | null | undefined,
  dict: Dictionary = getDictionary(),
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return notAvailable(dict);
  return numberFormatter(1).format(value);
}

export function formatDistanceKm(
  km: number | null | undefined,
  dict: Dictionary = getDictionary(),
): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return notAvailable(dict);
  return numberFormatter(km < 10 ? 1 : 0).format(km);
}

/** "35.8956° N, 14.4932° E" */
export function formatCoordinates(latitude: number, longitude: number): string {
  const lat = `${numberFormatter(4).format(Math.abs(latitude))}° ${latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${numberFormatter(4).format(Math.abs(longitude))}° ${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}

/** Ordered, comma-separated list with a localised final conjunction. */
export function formatList(items: string[], dict: Dictionary = getDictionary()): string {
  const clean = items.filter((item) => item.length > 0);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  const conjunction = t(dict, 'common.listAnd');
  return `${clean.slice(0, -1).join(', ')} ${conjunction} ${clean[clean.length - 1]}`;
}
