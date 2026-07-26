/**
 * Malta and Gozo monitoring stations.
 *
 * Coordinates, altitudes, station types and area classifications are taken
 * VERBATIM from the EEA station master list
 * (`content/raw_stations.json.*`, filtered on the `MT` code prefix), retrieved
 * 2026-07-26. See docs/DATA_SOURCE.md §4.
 *
 * Nothing in this file is estimated, geocoded, or recalled. If a station is not
 * in the upstream operational list, it is not here — that is why Kordin
 * (discontinued after 2016) is absent.
 *
 * All five stations are operated by Malta's Environment and Resources Authority.
 */

import type { PollutantCode } from './pollutants';

export type Island = 'Malta' | 'Gozo';

export type StationDefinition = {
  /** Upstream EEA/ERA station code. The join key — never localised. */
  id: string;
  /** URL slug. Stable, lowercase, ASCII. */
  slug: string;
  /**
   * Display name in correct Maltese orthography.
   *
   * The upstream feed carries unaccented ASCII ("Zejtun Station", "Gharb
   * Station"). Maltese diacritics matter, so we override for display while
   * keeping `id` as the join key.
   */
  name: string;
  /** Upstream name, retained for traceability and debugging. */
  upstreamName: string;
  locality: string;
  island: Island;
  latitude: number;
  longitude: number;
  altitudeMetres: number;
  /** EEA classification: what the station is sited to measure. */
  stationType: 'Background' | 'Traffic' | 'Industrial';
  areaClassification: 'Urban' | 'Suburban' | 'Rural' | 'Rural-Regional';
  /**
   * Pollutants this station has been OBSERVED to report.
   *
   * Derived from the data, not from what the station is nominally equipped to
   * measure: each entry was confirmed to have measured hours across a ~300-hour
   * window sampled 2026-07-26. Attard reports no SO2 and Msida reports no O3 —
   * both consistently, with zero measured hours.
   *
   * Getting this list wrong is not cosmetic. It feeds the `partial` flag, so an
   * over-optimistic list makes the API permanently report incomplete data and
   * the health endpoint permanently report "degraded", which trains operators to
   * ignore a signal that should mean something.
   *
   * Advisory only for the renderer: a station never shows a pollutant merely
   * because it is listed here, and never hides one that unexpectedly appears.
   */
  expectedPollutants: PollutantCode[];
  operator: string;
  sourceUrl: string;
  active: boolean;
};

export const STATIONS: StationDefinition[] = [
  {
    id: 'MT00008',
    slug: 'attard',
    name: 'Attard',
    upstreamName: 'Attard Station',
    locality: 'Attard',
    island: 'Malta',
    latitude: 35.890091,
    longitude: 14.434573,
    altitudeMetres: 86,
    stationType: 'Background',
    areaClassification: 'Urban',
    // Observed to report no SO2: zero measured hours across a ~300-hour window
    // sampled 2026-07-26, the same pattern as Msida and ozone.
    expectedPollutants: ['PM2.5', 'PM10', 'NO2', 'O3'],
    operator: 'Environment & Resources Authority (ERA)',
    sourceUrl: 'https://era.org.mt/topic/real-time-air-quality-network/',
    active: true,
  },
  {
    id: 'MT00007',
    slug: 'gharb',
    name: 'Għarb',
    upstreamName: 'Gharb Station',
    locality: 'Għarb',
    island: 'Gozo',
    latitude: 36.06705,
    longitude: 14.197074,
    altitudeMetres: 114,
    stationType: 'Background',
    areaClassification: 'Rural-Regional',
    expectedPollutants: ['PM2.5', 'PM10', 'NO2', 'O3', 'SO2'],
    operator: 'Environment & Resources Authority (ERA)',
    sourceUrl: 'https://era.org.mt/topic/real-time-air-quality-network/',
    active: true,
  },
  {
    id: 'MT00011',
    slug: 'msida',
    name: 'Msida',
    upstreamName: 'Msida Station',
    locality: 'Msida',
    island: 'Malta',
    latitude: 35.895563,
    longitude: 14.493217,
    altitudeMetres: 2,
    stationType: 'Traffic',
    areaClassification: 'Urban',
    // Observed to report no O3.
    expectedPollutants: ['PM2.5', 'PM10', 'NO2', 'SO2'],
    operator: 'Environment & Resources Authority (ERA)',
    sourceUrl: 'https://era.org.mt/topic/real-time-air-quality-network/',
    active: true,
  },
  {
    id: 'MT00009',
    slug: 'st-pauls-bay',
    name: "St Paul's Bay",
    upstreamName: "St. Paul's Bay Station",
    locality: 'San Pawl il-Baħar',
    island: 'Malta',
    latitude: 35.944845,
    longitude: 14.385739,
    altitudeMetres: 7,
    stationType: 'Traffic',
    areaClassification: 'Urban',
    expectedPollutants: ['PM2.5', 'PM10', 'NO2', 'O3', 'SO2'],
    operator: 'Environment & Resources Authority (ERA)',
    sourceUrl: 'https://era.org.mt/topic/real-time-air-quality-network/',
    active: true,
  },
  {
    id: 'MT00004',
    slug: 'zejtun',
    name: 'Żejtun',
    upstreamName: 'Zejtun Station',
    locality: 'Żejtun',
    island: 'Malta',
    latitude: 35.852266,
    longitude: 14.538941,
    altitudeMetres: 56,
    stationType: 'Background',
    areaClassification: 'Urban',
    expectedPollutants: ['PM2.5', 'PM10', 'NO2', 'O3', 'SO2'],
    operator: 'Environment & Resources Authority (ERA)',
    sourceUrl: 'https://era.org.mt/topic/real-time-air-quality-network/',
    active: true,
  },
];

const BY_ID = new Map(STATIONS.map((s) => [s.id, s]));
const BY_SLUG = new Map(STATIONS.map((s) => [s.slug, s]));

/** Accepts either an upstream code (`MT00011`) or a slug (`msida`). */
export function findStation(idOrSlug: string): StationDefinition | undefined {
  return BY_ID.get(idOrSlug.toUpperCase()) ?? BY_SLUG.get(idOrSlug.toLowerCase());
}

export const STATION_IDS = STATIONS.map((s) => s.id);

/**
 * Map viewport covering Malta and Gozo, and nothing else.
 *
 * Built from the station bounding box (14.197–14.539 E, 35.852–36.067 N) padded
 * to include the full coastline of both islands plus Comino. Deliberately tight:
 * the brief requires no gratuitous view of Sicily or the open Mediterranean.
 */
export const MALTA_BOUNDS: [[number, number], [number, number]] = [
  [14.14, 35.77],
  [14.61, 36.11],
];

export const MALTA_CENTRE: [number, number] = [14.3754, 35.9375];

export const MALTA_TIMEZONE = 'Europe/Malta' as const;
