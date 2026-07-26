/**
 * Public entry point for the map's non-React helpers.
 *
 * Everything re-exported here is free of MapLibre at RUNTIME — the only
 * reference to the library is a type-only import in `style.ts`, which the
 * compiler erases. A server component can therefore import from `@/lib/map`
 * (for the fallback station list, say) without dragging a WebGL renderer into
 * the server bundle.
 */

export {
  MAP_BACKGROUND_LAYER_ID,
  MAP_BASE_LAYER_ID,
  MAP_FIT_PADDING,
  MAP_MAX_BOUNDS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MAP_SOURCE_ID,
  MAP_TILE_HOST,
  MAP_TILE_URL,
  OSM_ATTRIBUTION_HTML,
  OSM_COPYRIGHT_URL,
  buildMapStyle,
  toColourScheme,
  type MapColourScheme,
  type MapStyle,
} from './style';

export {
  buildStationRows,
  isNotLive,
  orderStationsForMap,
  type MapStation,
  type MapStationRow,
} from './markers';

export { isWebGL2Available, resetWebGLProbe } from './webgl';
