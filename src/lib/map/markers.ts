/**
 * Turning readings into what a marker actually shows.
 *
 * The map, the marker and the no-map fallback list must agree completely: same
 * stations, same order, same band, same caveats. They therefore share this one
 * derivation rather than each doing its own — a fallback list that disagreed
 * with the map it replaced would be worse than no fallback at all.
 *
 * Nothing here computes an index. Bands and sub-indices arrive already
 * calculated by `src/lib/air-quality/calculate-index.ts`; this module only
 * selects between them.
 */

import type { PollutantCode } from '@/config/pollutants';
import type { Island } from '@/config/stations';
import { CATEGORY_PRESENTATION, type AirQualityCategory } from '@/config/thresholds';
import type { FreshnessState, StationReading } from '@/lib/air-quality/types';

/**
 * The station fields the map needs.
 *
 * Structural rather than a named import so both `StationDefinition` (the static
 * config) and `AirQualityStation` (what the service returns) satisfy it without
 * a conversion step at every call site.
 */
export type MapStation = {
  id: string;
  slug: string;
  name: string;
  locality: string;
  island: Island;
  latitude: number;
  longitude: number;
};

export type MapStationRow = {
  station: MapStation;
  /** `null` when the station published nothing for the current hour. */
  reading: StationReading | null;
  /**
   * Band to display. `null` is a first-class state meaning "no index" and must
   * never be rendered as Good.
   */
  category: AirQualityCategory | null;
  subIndex: number | null;
  /** Set only when a single pollutant is being shown. */
  value: number | null;
  unit: string | null;
  /** True when the displayed value is modelled or forecast, not measured. */
  modelled: boolean;
  /** True where the band warrants a prominent warning. */
  elevated: boolean;
  freshness: FreshnessState;
  measuredAt: string | null;
  fetchedAt: string | null;
  ageHours: number | null;
  /** True when the reading exists but this pollutant is absent from it. */
  pollutantMissing: boolean;
};

const EMPTY_ROW = {
  category: null,
  subIndex: null,
  value: null,
  unit: null,
  modelled: false,
  elevated: false,
} as const;

/**
 * Display order: Malta first, then Gozo, alphabetical within each island.
 *
 * The order is fixed here so that tabbing between markers and reading the
 * fallback list walk the same sequence. `localeCompare` is pinned to `en`
 * because the default locale differs between the server and the browser and
 * would produce a hydration mismatch on names carrying Maltese diacritics.
 */
export function orderStationsForMap<T extends MapStation>(stations: readonly T[]): T[] {
  return [...stations].sort((a, b) => {
    if (a.island !== b.island) return a.island === 'Gozo' ? 1 : -1;
    return a.name.localeCompare(b.name, 'en');
  });
}

/**
 * Resolve the band a marker should show.
 *
 * With no pollutant filter this is the station's overall band, whose `modelled`
 * flag is taken from the pollutant that produced it — the dominant one — because
 * that is the value the band is actually claiming.
 *
 * With a filter there are THREE outcomes, not two. The pollutant may be absent
 * from the payload entirely (this station does not report it), or present with
 * a `null` value (the instrument reported nothing usable this hour). Both are
 * the no-data state. Neither is Good.
 */
function resolveBand(
  reading: StationReading,
  pollutant: PollutantCode | null,
): Pick<MapStationRow, 'category' | 'subIndex' | 'value' | 'unit' | 'modelled' | 'elevated'> & {
  pollutantMissing: boolean;
} {
  if (!pollutant) {
    const dominant = reading.dominantPollutant
      ? reading.pollutants[reading.dominantPollutant]
      : undefined;

    return {
      category: reading.overallCategory,
      subIndex: reading.overallSubIndex,
      value: null,
      unit: null,
      modelled: dominant?.modelled ?? false,
      elevated: reading.overallCategory
        ? CATEGORY_PRESENTATION[reading.overallCategory].elevated
        : false,
      pollutantMissing: false,
    };
  }

  const entry = reading.pollutants[pollutant];
  if (!entry) return { ...EMPTY_ROW, pollutantMissing: true };
  if (entry.value === null || entry.category === null) {
    return { ...EMPTY_ROW, unit: entry.unit, pollutantMissing: false };
  }

  return {
    category: entry.category,
    subIndex: entry.subIndex,
    value: entry.value,
    unit: entry.unit,
    modelled: entry.modelled,
    elevated: CATEGORY_PRESENTATION[entry.category].elevated,
    pollutantMissing: false,
  };
}

/**
 * Pair every station with its reading, in display order.
 *
 * A station with no reading is KEPT and marked unavailable rather than dropped.
 * Silently removing it would leave a gap on the map that reads as "nothing to
 * report here", which is the opposite of what an absent reading means.
 */
export function buildStationRows(
  stations: readonly MapStation[],
  readings: readonly StationReading[],
  pollutant: PollutantCode | null = null,
): MapStationRow[] {
  const byStation = new Map(readings.map((reading) => [reading.stationId, reading]));

  return orderStationsForMap(stations).map((station) => {
    const reading = byStation.get(station.id) ?? null;

    if (!reading) {
      return {
        station,
        reading: null,
        ...EMPTY_ROW,
        freshness: 'unavailable' as const,
        measuredAt: null,
        fetchedAt: null,
        ageHours: null,
        pollutantMissing: false,
      };
    }

    const band = resolveBand(reading, pollutant);

    return {
      station,
      reading,
      category: band.category,
      subIndex: band.subIndex,
      value: band.value,
      unit: band.unit,
      modelled: band.modelled,
      elevated: band.elevated,
      freshness: reading.freshness,
      measuredAt: reading.measuredAt,
      fetchedAt: reading.fetchedAt,
      ageHours: reading.ageHours,
      pollutantMissing: band.pollutantMissing,
    };
  });
}

/** True when the reading is too old to describe the present. */
export function isNotLive(freshness: FreshnessState): boolean {
  return freshness === 'stale' || freshness === 'unavailable';
}
