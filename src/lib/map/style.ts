/**
 * Base-map style for the station map.
 *
 * The style is built here, in code, from a plain raster OpenStreetMap source
 * rather than fetched from a vendor style URL. That is a deliberate constraint:
 * a hosted vector style would put an API key, a third-party availability
 * dependency and a per-view billing relationship between a member of the public
 * and a public-health reading. A raster style has none of those, works offline
 * behind a caching proxy, and degrades to "tiles missing" rather than "map
 * missing" when the tile server is unreachable.
 *
 * Two schemes are produced from ONE source. They differ only in the raster
 * paint properties, so switching themes is a paint update rather than a style
 * reload — no tile is re-fetched when the user toggles light and dark.
 *
 * Be honest about what the dark scheme is: OpenStreetMap's standard tiles are
 * drawn for a light background, so "dark" here means dimmed and desaturated,
 * not redrawn. That is the intended effect — the base map recedes and the six
 * air-quality colours stay the brightest thing on the screen.
 */

import type { MapOptions } from 'maplibre-gl';

/**
 * The style-object half of `MapOptions['style']`.
 *
 * `StyleSpecification` lives in `@maplibre/maplibre-gl-style-spec`, which is a
 * transitive dependency and is not resolvable from this package under pnpm's
 * strict layout. Deriving the type from the public `MapOptions` surface gives
 * exactly the same type without depending on a package we do not declare.
 */
export type MapStyle = Exclude<NonNullable<MapOptions['style']>, string>;

export type MapColourScheme = 'light' | 'dark';

/* -------------------------------------------------------------------------- */
/*  Source                                                                    */
/* -------------------------------------------------------------------------- */

export const MAP_SOURCE_ID = 'osm-raster';
export const MAP_BASE_LAYER_ID = 'osm-raster';
export const MAP_BACKGROUND_LAYER_ID = 'sea';

export const MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Host the browser fetches tiles from, for anyone writing a content policy. */
export const MAP_TILE_HOST = 'tile.openstreetmap.org';

export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

/**
 * Attribution carried on the source itself.
 *
 * MapLibre's own attribution control is switched off in favour of an accessible,
 * translated, theme-aware block rendered by the map component — but the string
 * stays here so the style remains correct and self-describing if it is ever
 * loaded by something else.
 */
export const OSM_ATTRIBUTION_HTML =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

/** OpenStreetMap's raster tiles are published to zoom 19. */
const MAP_TILE_MAX_ZOOM = 19;

const MAP_TILE_SIZE = 256;

/* -------------------------------------------------------------------------- */
/*  Camera limits                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Hard pan limit, deliberately looser than `MALTA_BOUNDS`.
 *
 * `maxBounds` clamps the CENTRE of the viewport, so setting it equal to the
 * bounds we fit would fight the initial `fitBounds` and leave the islands
 * off-centre in wide containers. The padding here is roughly a third of a
 * degree in each direction: enough room to fit and to pan around the coastline,
 * not enough to wander off to Sicily or Tunisia.
 */
export const MAP_MAX_BOUNDS: [[number, number], [number, number]] = [
  [13.79, 35.42],
  [14.96, 36.46],
];

/**
 * Minimum zoom.
 *
 * This is what actually enforces "no gratuitous Mediterranean". Fitting
 * `MALTA_BOUNDS` lands around zoom 10 in a typical container and never below
 * about 9.8 in the widest ones, so 8.5 leaves headroom for a pinch-out without
 * opening up the open sea.
 */
export const MAP_MIN_ZOOM = 8.5;

/** Beyond this the raster tiles are being upscaled and read as a blur. */
export const MAP_MAX_ZOOM = 17;

/**
 * Padding used when fitting Malta and Gozo.
 *
 * Asymmetric on purpose: the control cluster sits top-right and the attribution
 * strip sits bottom-left, so those edges get more room and no station marker is
 * ever born underneath a button.
 */
export const MAP_FIT_PADDING = { top: 32, right: 64, bottom: 48, left: 28 } as const;

/* -------------------------------------------------------------------------- */
/*  Schemes                                                                   */
/* -------------------------------------------------------------------------- */

type RasterPaint = {
  'raster-saturation': number;
  'raster-contrast': number;
  'raster-brightness-min': number;
  'raster-brightness-max': number;
  'raster-opacity': number;
};

type SchemePresentation = {
  /** Shown before any tile arrives, and behind the raster in dark mode. */
  background: string;
  raster: RasterPaint;
};

/**
 * Light desaturates gently; dark dims hard.
 *
 * The numbers were chosen against the six band colours rather than in the
 * abstract: `#f0e641` (Moderate) and `#50f0e6` (Good) are the two that lose
 * most against a busy base map, and both stay clearly separable from the tiles
 * at these settings. Background colours mirror the `--background` tokens in
 * `globals.css`; they are written as literals because the style specification
 * is parsed by MapLibre and cannot resolve CSS custom properties.
 */
const SCHEMES: Record<MapColourScheme, SchemePresentation> = {
  light: {
    background: '#dce8ef',
    raster: {
      'raster-saturation': -0.32,
      'raster-contrast': -0.06,
      'raster-brightness-min': 0.06,
      'raster-brightness-max': 0.97,
      'raster-opacity': 1,
    },
  },
  dark: {
    background: '#08192a',
    raster: {
      'raster-saturation': -0.42,
      'raster-contrast': -0.14,
      'raster-brightness-min': 0.02,
      'raster-brightness-max': 0.55,
      'raster-opacity': 0.9,
    },
  },
};

/**
 * Build the complete style for a colour scheme.
 *
 * A fresh object is returned each call. MapLibre mutates the style it is given
 * while it loads, so handing out a shared frozen constant would corrupt the
 * next map created from it.
 */
export function buildMapStyle(scheme: MapColourScheme): MapStyle {
  const presentation = SCHEMES[scheme];

  return {
    version: 8,
    // No text is drawn from the style — the raster tiles carry their own
    // labels — so no glyph or sprite endpoint is needed, and none is requested.
    sources: {
      [MAP_SOURCE_ID]: {
        type: 'raster',
        tiles: [MAP_TILE_URL],
        tileSize: MAP_TILE_SIZE,
        maxzoom: MAP_TILE_MAX_ZOOM,
        attribution: OSM_ATTRIBUTION_HTML,
      },
    },
    layers: [
      {
        id: MAP_BACKGROUND_LAYER_ID,
        type: 'background',
        paint: { 'background-color': presentation.background },
      },
      {
        id: MAP_BASE_LAYER_ID,
        type: 'raster',
        source: MAP_SOURCE_ID,
        paint: { ...presentation.raster },
      },
    ],
  };
}

/** Resolve a next-themes value, falling back to light. */
export function toColourScheme(theme: string | undefined): MapColourScheme {
  return theme === 'dark' ? 'dark' : 'light';
}
