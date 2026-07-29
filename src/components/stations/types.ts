/**
 * Shared shapes and label helpers for the station components.
 *
 * The application holds a station in two forms: `StationDefinition` from
 * `src/config/stations.ts` (what we know statically) and `AirQualityStation`
 * from the domain model (what a provider returns). They agree on everything the
 * UI renders but differ elsewhere — `expectedPollutants` versus
 * `pollutantsMeasured`, and literal unions versus plain `string`.
 *
 * Rather than pick one and force every caller to convert, the components accept
 * the structural intersection below. Both types satisfy it, and the fields that
 * genuinely differ are passed separately where a component needs them.
 */

import type { Island } from '@/config/stations';
import type { StationReading } from '@/lib/air-quality/types';
import { getDictionary, t, type Dictionary } from '@/lib/i18n';

export type StationDescriptor = {
  id: string;
  slug: string;
  name: string;
  locality: string;
  island: Island;
  latitude: number;
  longitude: number;
  altitudeMetres: number;
  stationType: string;
  areaClassification: string;
  operator: string;
  sourceUrl: string;
  active: boolean;
};

/**
 * A station paired with its current reading.
 *
 * `reading: null` is a first-class state meaning the station published nothing
 * usable for this hour. It is never collapsed into an empty reading, because an
 * empty reading would render as a row of zeroes.
 */
export type StationEntry = {
  station: StationDescriptor;
  reading: StationReading | null;
};

/* -------------------------------------------------------------------------- */
/*  Label lookups                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Typed as possibly-undefined on purpose.
 *
 * `AirQualityStation.stationType` is a bare `string`, so an unrecognised value
 * can reach these maps. Falling back to the raw upstream value keeps the cell
 * truthful; silently rendering an empty string would hide a data change.
 */
const ISLAND_KEYS: Record<string, string | undefined> = {
  Malta: 'station.island.malta',
  Gozo: 'station.island.gozo',
};

const STATION_TYPE_KEYS: Record<string, string | undefined> = {
  Background: 'station.type.background',
  Traffic: 'station.type.traffic',
  Industrial: 'station.type.industrial',
};

const STATION_TYPE_EXPLAIN_KEYS: Record<string, string | undefined> = {
  Background: 'station.type.backgroundExplain',
  Traffic: 'station.type.trafficExplain',
  Industrial: 'station.type.industrialExplain',
};

const AREA_KEYS: Record<string, string | undefined> = {
  Urban: 'station.area.urban',
  Suburban: 'station.area.suburban',
  Rural: 'station.area.rural',
  'Rural-Regional': 'station.area.ruralRegional',
};

export function islandLabel(island: string, dict: Dictionary = getDictionary()): string {
  const key = ISLAND_KEYS[island];
  return key ? t(dict, key) : island;
}

export function stationTypeLabel(type: string, dict: Dictionary = getDictionary()): string {
  const key = STATION_TYPE_KEYS[type];
  return key ? t(dict, key) : type;
}

/** Why the station is sited where it is. `null` when the type is unrecognised. */
export function stationTypeExplanation(
  type: string,
  dict: Dictionary = getDictionary(),
): string | null {
  const key = STATION_TYPE_EXPLAIN_KEYS[type];
  return key ? t(dict, key) : null;
}

export function areaLabel(area: string, dict: Dictionary = getDictionary()): string {
  const key = AREA_KEYS[area];
  return key ? t(dict, key) : area;
}

/* -------------------------------------------------------------------------- */
/*  Routing                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Canonical path for a station's full page.
 *
 * Kept here so the list, the card, the panel and the sheet cannot drift apart.
 * Every component that links to a station also accepts an `href` override, for
 * callers that mount the routes elsewhere.
 *
 * SINGULAR. The route is `src/app/station/[stationId]`, and the sitemap, the
 * `canonical` metadata and the not-found page all say `/station/` too. This
 * helper said `/stations/` and so produced a 404 from every card, row and
 * panel on the site. Only `/api/stations` is plural — that is the collection
 * endpoint, and it is a different namespace.
 */
export function stationHref(station: Pick<StationDescriptor, 'slug'>): string {
  return `/station/${station.slug}`;
}
