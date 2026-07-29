'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import {
  Compass,
  LoaderCircle,
  LocateFixed,
  Maximize,
  Minus,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import type { MapSourceDataEvent, Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { useTheme } from 'next-themes';
import * as React from 'react';
import { createPortal } from 'react-dom';

import { MapFallback } from '@/components/map/map-fallback';
import { MapLegend } from '@/components/map/map-legend';
import { MapLoading } from '@/components/map/map-loading';
import { StationMarker } from '@/components/map/station-marker';
import type { PollutantCode } from '@/config/pollutants';
import { MALTA_BOUNDS, STATIONS } from '@/config/stations';
import type { StationReading } from '@/lib/air-quality/types';
import { getDictionary, hasKey, t, type Dictionary } from '@/lib/i18n';
import {
  MAP_FIT_PADDING,
  MAP_MAX_BOUNDS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MAP_SOURCE_ID,
  buildMapStyle,
  toColourScheme,
  type MapColourScheme,
} from '@/lib/map/style';
import { buildStationRows, orderStationsForMap, type MapStation } from '@/lib/map/markers';
import { isWebGL2Available } from '@/lib/map/webgl';
import { cn } from '@/lib/utils/cn';

/* -------------------------------------------------------------------------- */
/*  Copy the shared dictionary does not carry yet                             */
/* -------------------------------------------------------------------------- */

/**
 * Two strings this component needs that `src/lib/i18n/dictionary.ts` — which is
 * owned elsewhere and must not be edited from here — does not yet define.
 *
 * `t()` deliberately returns the key itself when a key is missing, which is the
 * right behaviour for a translator's build but the wrong thing to show a member
 * of the public: nobody should read "map.resetBearing" on a public-health page.
 * These two entries stand in until the keys land, and stop being consulted the
 * moment they do, because `hasKey` is checked first. They are not a parallel
 * dictionary — anything with a real key goes through `t()` as normal.
 */
const PENDING_MAP_COPY: Record<string, string> = {
  'map.resetBearing': 'Point the map north',
  'map.locateOutside': 'Your location is outside Malta and Gozo, so the view has not moved.',
};

function mapText(dict: Dictionary, key: string): string {
  if (hasKey(dict, key)) return t(dict, key);
  return PENDING_MAP_COPY[key] ?? t(dict, key);
}

/* -------------------------------------------------------------------------- */
/*  Local helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Number of tile requests that may fail before the map is written off.
 *
 * Paired with "and not one tile has ever arrived". A handful of failures on a
 * map that is already drawing is a flaky connection, not a broken base map, and
 * must not tear down a perfectly readable view.
 */
const TILE_FAILURE_LIMIT = 3;

/** How long to wait for the first complete render before giving up. */
const LOAD_TIMEOUT_MS = 15_000;

const DEFAULT_HEIGHT = 'h-[26rem] sm:h-[30rem]';

/**
 * Classes on the element MapLibre positions.
 *
 * Written as a plain string because the element is created imperatively; the
 * Tailwind scanner reads source files as text, so these candidates are still
 * generated. The z-index has to live on this element rather than on the button
 * inside it: each marker element is its own stacking context, so a z-index set
 * deeper down could never lift one marker above another.
 */
const MARKER_HOST_CLASS = 'z-10 has-[:hover]:z-30 has-[:focus-visible]:z-40';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Read the theme straight off the document, for use inside effects only. */
function schemeFromDocument(): MapColourScheme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function isWithinMaxBounds(longitude: number, latitude: number): boolean {
  const [[west, south], [east, north]] = MAP_MAX_BOUNDS;
  return longitude >= west && longitude <= east && latitude >= south && latitude <= north;
}

/**
 * WebGL support, read through `useSyncExternalStore`.
 *
 * The obvious alternatives are both wrong. Probing in a state initialiser runs
 * the probe during server rendering, where it can only answer "no", and the
 * browser then disagrees — a hydration mismatch. Probing in an effect and
 * calling `setState` is a cascading render, which is what
 * `react-hooks/set-state-in-effect` exists to stop.
 *
 * `useSyncExternalStore` is the API built for exactly this: a value read from
 * outside React, with an explicit server answer that the client is allowed to
 * contradict after hydration. The subscription is a no-op because a GPU does
 * not appear halfway through a page's life.
 *
 * The server answer is "supported", so the server renders the map's skeleton
 * rather than the fallback list. A page that would rather serve the list
 * outright should render `MapFallback` itself and load the map lazily.
 */
const subscribeToNothing = () => () => {};
const webglSupportedOnServer = () => true;

type MapPhase = 'pending' | 'ready' | 'unsupported' | 'degraded';

type LocateState = 'idle' | 'busy' | 'denied' | 'unavailable' | 'outside';

const LOCATE_MESSAGE_KEYS: Record<Exclude<LocateState, 'idle'>, string> = {
  busy: 'map.locating',
  denied: 'map.locateDenied',
  unavailable: 'map.locateUnavailable',
  outside: 'map.locateOutside',
};

/* -------------------------------------------------------------------------- */
/*  Controls                                                                  */
/* -------------------------------------------------------------------------- */

type MapControlButtonProps = Omit<React.ComponentProps<'button'>, 'children'> & {
  label: string;
  icon: LucideIcon;
  /** Set only by the compass, whose needle is rotated imperatively. */
  iconRef?: React.Ref<SVGSVGElement>;
};

/**
 * One map control.
 *
 * 44px square, which is the brief's minimum target and considerably larger than
 * MapLibre's own 29px controls — one of the reasons these are built here rather
 * than mounted as an `IControl`. The other is that the label comes from the
 * dictionary, whereas MapLibre's controls carry untranslatable English.
 */
function MapControlButton({
  label,
  icon: Icon,
  iconRef,
  disabled,
  onClick,
  className,
  ...props
}: MapControlButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // `aria-disabled` rather than the native attribute. A control that goes
      // natively disabled the moment it is used — the zoom button that reaches
      // maximum zoom, the locate button that starts working — takes the
      // keyboard user's focus back to the top of the document with it. This
      // stays focusable, reports its state, and declines the click below.
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cn(
        'rounded-card flex size-11 items-center justify-center',
        'border-border bg-surface/95 text-foreground shadow-card border backdrop-blur-sm',
        'hover:bg-muted transition-colors',
        'aria-disabled:hover:bg-surface/95 aria-disabled:cursor-default aria-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Icon className="size-5" ref={iconRef} aria-hidden="true" />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Map                                                                       */
/* -------------------------------------------------------------------------- */

export type AirQualityMapProps = {
  /** Current readings. Stations without one are still shown, as "no data". */
  readings?: readonly StationReading[];
  /** Defaults to the five verified stations in `src/config/stations.ts`. */
  stations?: readonly MapStation[];
  /** Show one pollutant's band instead of each station's overall band. */
  pollutant?: PollutantCode | null;
  /** Controlled selection. Leave undefined to let the map manage its own. */
  selectedStationId?: string | null;
  defaultSelectedStationId?: string | null;
  onSelectStation?: (stationId: string) => void;
  /** Render the legend beneath the map. */
  showLegend?: boolean;
  /**
   * Heading level for the fallback that replaces the map when it cannot run.
   *
   * The map itself contributes no heading, so this only shows up in the failure
   * path — which is exactly where it went wrong: the default of 3 put an `h3`
   * directly beneath the page `h1`, a gap that leaves a screen-reader user
   * guessing at the structure. Callers know their own depth, so they set it.
   */
  fallbackHeadingLevel?: 2 | 3 | 4;
  /** Height utilities for the map surface. */
  heightClassName?: string;
  dict?: Dictionary;
  className?: string;
  id?: string;
};

/**
 * The station map.
 *
 * Five markers on a plain OpenStreetMap raster base. There is no interpolated
 * pollution surface and there will not be one: five instruments across two
 * islands cannot support a continuous field, and drawing one would invent
 * readings for places nobody is measuring. What is shown is what is measured,
 * where it is measured.
 *
 * Everything the map can fail at has a defined outcome. No WebGL, no tiles, no
 * first render inside fifteen seconds — each of them lands on the same station
 * list, which is the information the reader came for. The map is a convenience
 * on top of that list, never a precondition for it.
 *
 * The markers are real buttons in the DOM, positioned by MapLibre over the
 * canvas rather than painted into it, so they can be tabbed to, announced,
 * focused visibly and hit comfortably.
 */
export function AirQualityMap({
  readings = [],
  stations = STATIONS,
  pollutant = null,
  selectedStationId,
  defaultSelectedStationId = null,
  onSelectStation,
  showLegend = true,
  fallbackHeadingLevel = 2,
  heightClassName = DEFAULT_HEIGHT,
  dict = getDictionary(),
  className,
  id = 'air-quality-map',
}: AirQualityMapProps) {
  const { resolvedTheme } = useTheme();

  const webglSupported = React.useSyncExternalStore(
    subscribeToNothing,
    isWebGL2Available,
    webglSupportedOnServer,
  );

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const compassRef = React.useRef<SVGSVGElement | null>(null);

  const [phase, setPhase] = React.useState<MapPhase>('pending');
  const [markerHosts, setMarkerHosts] = React.useState<{ id: string; element: HTMLElement }[]>([]);
  const [locateState, setLocateState] = React.useState<LocateState>('idle');
  const [zoomLimits, setZoomLimits] = React.useState({ canZoomIn: true, canZoomOut: true });

  const [internalSelection, setInternalSelection] = React.useState<string | null>(
    defaultSelectedStationId,
  );
  const selection = selectedStationId === undefined ? internalSelection : selectedStationId;

  const orderedStations = React.useMemo(() => orderStationsForMap(stations), [stations]);
  const rows = React.useMemo(
    () => buildStationRows(orderedStations, readings, pollutant),
    [orderedStations, readings, pollutant],
  );
  const rowsByStation = React.useMemo(
    () => new Map(rows.map((row) => [row.station.id, row])),
    [rows],
  );

  /**
   * Identity of the station SET, coordinates included.
   *
   * The map is built once and the markers with it; readings then flow into them
   * through the portals below and never touch MapLibre. Only a genuine change
   * of station or position — which the verified config makes a once-in-years
   * event — justifies rebuilding, and this key is what detects one. Anything
   * looser, such as depending on the `stations` array itself, would tear the map
   * down on every render that happened to pass a new array literal.
   */
  const stationKey = orderedStations
    .map((station) => `${station.id}:${station.latitude}:${station.longitude}`)
    .join('|');

  // Refs the map effect reads. Written from an effect rather than during render
  // so nothing is mutated while React is rendering.
  const latestRef = React.useRef({ stations: orderedStations, dict, resolvedTheme });
  React.useEffect(() => {
    latestRef.current = { stations: orderedStations, dict, resolvedTheme };
  });

  /* --- Build the map -------------------------------------------------- */

  React.useEffect(() => {
    const container = containerRef.current;
    // Nothing is constructed without WebGL 2, and nothing needs to be: the
    // fallback list is already rendered in that case.
    if (!container || !webglSupported) return;

    let cancelled = false;
    let teardown = () => {};

    void (async () => {
      let maplibre: typeof import('maplibre-gl');
      try {
        // Imported here rather than at module scope: the renderer is a large
        // chunk that only ever runs in a browser, and a page that never shows
        // the map should never download or evaluate it.
        maplibre = await import('maplibre-gl');
      } catch {
        if (!cancelled) setPhase('degraded');
        return;
      }
      if (cancelled) return;

      const {
        stations: currentStations,
        dict: currentDict,
        resolvedTheme: currentTheme,
      } = latestRef.current;

      let map: MapLibreMap;
      try {
        map = new maplibre.Map({
          container,
          style: buildMapStyle(currentTheme ? toColourScheme(currentTheme) : schemeFromDocument()),
          // `MALTA_BOUNDS` is already [south-west, north-east] in [lng, lat]
          // order, which is exactly what MapLibre wants. Do not "fix" it.
          bounds: MALTA_BOUNDS,
          fitBoundsOptions: { padding: MAP_FIT_PADDING },
          maxBounds: MAP_MAX_BOUNDS,
          minZoom: MAP_MIN_ZOOM,
          maxZoom: MAP_MAX_ZOOM,
          // Plan view only. Pitch on a five-marker map buys nothing and makes
          // the marker labels overlap unpredictably.
          maxPitch: 0,
          pitchWithRotate: false,
          touchPitch: false,
          attributionControl: false,
          maplibreLogo: false,
          // Names the focusable canvas, which is how a keyboard user pans and
          // zooms with the arrow keys.
          locale: { 'Map.Title': t(currentDict, 'map.title') },
        });
      } catch {
        // GPUInitializationError and friends: WebGL 2 was advertised but the
        // context could not actually be created.
        if (!cancelled) setPhase('unsupported');
        return;
      }

      const markers: MapLibreMarker[] = [];
      const timers: ReturnType<typeof setTimeout>[] = [];
      let torn = false;

      teardown = () => {
        if (torn) return;
        torn = true;
        for (const timer of timers) clearTimeout(timer);
        for (const marker of markers) marker.remove();
        markers.length = 0;
        mapRef.current = null;
        map.remove();
      };

      if (cancelled) {
        teardown();
        return;
      }

      mapRef.current = map;

      /* Tile health. */
      let tileArrived = false;
      let tileFailures = 0;
      let loaded = false;

      const degrade = () => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[maqua] base map unavailable, falling back to the station list');
        }
        setMarkerHosts([]);
        setPhase('degraded');
        teardown();
      };

      map.on('sourcedata', (event: MapSourceDataEvent) => {
        if (event.sourceId === MAP_SOURCE_ID && event.tile) tileArrived = true;
      });

      map.on('error', (event) => {
        // `sourceId` is attached by MapLibre to tile-loading failures but is not
        // part of the declared `ErrorEvent` shape, so it is read defensively.
        const sourceId = (event as unknown as { sourceId?: string }).sourceId;
        if (sourceId !== MAP_SOURCE_ID) return;
        tileFailures += 1;
        if (tileFailures >= TILE_FAILURE_LIMIT && !tileArrived) degrade();
      });

      map.on('load', () => {
        loaded = true;
        for (const timer of timers) clearTimeout(timer);
        setPhase('ready');
        setZoomLimits({
          canZoomIn: map.getZoom() < map.getMaxZoom(),
          canZoomOut: map.getZoom() > map.getMinZoom(),
        });

        /**
         * Markers, in the same order as the fallback list.
         *
         * Created on `load` rather than immediately after construction, and the
         * reason is not stylistic. Each marker host carries a positive z-index,
         * which it needs so that a hovered or focused marker can rise above its
         * neighbours. The loading skeleton is an ordinary `absolute inset-0`
         * overlay at `z-auto` in the same stacking context, so markers added
         * before the skeleton goes away would paint straight through it — five
         * live, tabbable buttons floating on a placeholder. Adding them here
         * means the map is drawn by the time they exist.
         */
        const hosts: { id: string; element: HTMLElement }[] = [];
        for (const station of currentStations) {
          const element = document.createElement('div');
          // MapLibre gives a marker element `tabindex="0"` when it has none,
          // which would put an unnamed tab stop in front of the button inside.
          // Claiming the attribute first leaves exactly one focusable thing per
          // station.
          element.setAttribute('tabindex', '-1');
          element.className = MARKER_HOST_CLASS;

          const marker = new maplibre.Marker({
            element,
            // The pin is a circle centred on the station, so the marker's anchor
            // is its centre. The name below it is positioned out of flow and
            // does not shift the pin off the coordinate.
            anchor: 'center',
            subpixelPositioning: true,
          })
            .setLngLat([station.longitude, station.latitude])
            .addTo(map);

          markers.push(marker);
          hosts.push({ id: station.id, element });
        }

        setMarkerHosts(hosts);
      });

      // Last resort. A base map that has not produced a first render in fifteen
      // seconds is not going to, and the reader should not be watching a
      // skeleton pulse indefinitely while a list would have answered them.
      timers.push(
        setTimeout(() => {
          if (!loaded) degrade();
        }, LOAD_TIMEOUT_MS),
      );

      map.on('zoomend', () => {
        setZoomLimits({
          canZoomIn: map.getZoom() < map.getMaxZoom(),
          canZoomOut: map.getZoom() > map.getMinZoom(),
        });
      });

      // The compass needle is written straight to the DOM rather than held in
      // state: a drag-rotate fires this on every frame, and re-rendering five
      // portalled markers sixty times a second to turn one arrow would be
      // absurd.
      const syncCompass = () => {
        if (compassRef.current) compassRef.current.style.rotate = `${-map.getBearing()}deg`;
      };
      map.on('rotate', syncCompass);
      map.on('load', syncCompass);
    })();

    return () => {
      cancelled = true;
      teardown();
      setMarkerHosts([]);
    };
  }, [stationKey, webglSupported]);

  /* --- Theme ---------------------------------------------------------- */

  /**
   * Light and dark differ only in raster paint properties, so this is a diffed
   * paint update and not a style reload — no tile is re-fetched when the reader
   * changes theme, and nothing flashes.
   *
   * The scheme is resolved exactly as the constructor resolves it, DOM fallback
   * included. Treating an unresolved `resolvedTheme` as light here would undo
   * that fallback: a page without a `ThemeProvider` would build the map dark
   * from the document's own class and then be forced back to light the moment
   * this effect first ran.
   */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || phase !== 'ready') return;
    map.setStyle(
      buildMapStyle(resolvedTheme ? toColourScheme(resolvedTheme) : schemeFromDocument()),
    );
  }, [resolvedTheme, phase]);

  /* --- Actions -------------------------------------------------------- */

  const cameraDuration = () => (prefersReducedMotion() ? 0 : 600);

  const handleZoomIn = () => mapRef.current?.zoomIn({ duration: cameraDuration() });
  const handleZoomOut = () => mapRef.current?.zoomOut({ duration: cameraDuration() });

  const handleResetBearing = () =>
    mapRef.current?.easeTo({ bearing: 0, duration: cameraDuration() });

  const handleResetView = () =>
    mapRef.current?.fitBounds(MALTA_BOUNDS, {
      padding: MAP_FIT_PADDING,
      // Bearing and pitch are reset too. "Reset the view" that left the map
      // rotated would not be a reset.
      bearing: 0,
      pitch: 0,
      duration: cameraDuration(),
    });

  /**
   * Find the reader's position, once, on request.
   *
   * Nothing here runs until this button is pressed, so the permission prompt is
   * never a surprise. It is `getCurrentPosition` and not `watchPosition`: one
   * fix, used to move the camera, never stored, never sent anywhere.
   */
  const handleLocate = () => {
    const map = mapRef.current;
    if (!map || locateState === 'busy') return;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocateState('unavailable');
      return;
    }

    setLocateState('busy');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords;
        // Outside Malta and Gozo the camera stays where it is. Panning to a
        // reader in Berlin would show them an empty sea and no stations, and
        // "unavailable" would be a lie — the fix worked, it is just not here.
        if (!isWithinMaxBounds(longitude, latitude)) {
          setLocateState('outside');
          return;
        }
        setLocateState('idle');
        map.easeTo({
          center: [longitude, latitude],
          zoom: Math.max(map.getZoom(), 12.5),
          duration: cameraDuration(),
        });
      },
      (error) => {
        setLocateState(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const handleSelect = (stationId: string) => {
    if (selectedStationId === undefined) setInternalSelection(stationId);
    onSelectStation?.(stationId);
  };

  /* --- Render --------------------------------------------------------- */

  const hintId = `${id}-hint`;
  // `unsupported` covers the case where WebGL 2 was advertised but the context
  // could not actually be created — the probe cannot see that in advance.
  const noRenderer = !webglSupported || phase === 'unsupported';
  const failed = noRenderer || phase === 'degraded';
  const locateMessage =
    locateState === 'idle' ? '' : mapText(dict, LOCATE_MESSAGE_KEYS[locateState]);

  return (
    <div
      data-slot="air-quality-map"
      data-map-phase={webglSupported ? phase : 'unsupported'}
      className={cn('space-y-3', className)}
    >
      {failed ? (
        <MapFallback
          stations={orderedStations}
          readings={readings}
          reason={noRenderer ? 'webgl' : 'tiles'}
          pollutant={pollutant}
          selectedStationId={selection}
          onSelectStation={handleSelect}
          headingLevel={fallbackHeadingLevel}
          dict={dict}
          id={`${id}-fallback`}
        />
      ) : (
        <div
          role="group"
          aria-label={t(dict, 'map.title')}
          aria-describedby={hintId}
          className="rounded-card border-border bg-surface-sunken relative overflow-hidden border"
        >
          <div ref={containerRef} id={`${id}-canvas`} className={cn('w-full', heightClassName)} />

          {phase === 'pending' ? (
            <MapLoading
              className="absolute inset-0 rounded-none border-0"
              heightClassName={heightClassName}
              dict={dict}
            />
          ) : null}

          {phase === 'ready' ? (
            <div data-print-hidden className="absolute top-3 right-3 z-20 flex flex-col gap-1.5">
              <MapControlButton
                label={t(dict, 'map.zoomIn')}
                icon={Plus}
                onClick={handleZoomIn}
                disabled={!zoomLimits.canZoomIn}
              />
              <MapControlButton
                label={t(dict, 'map.zoomOut')}
                icon={Minus}
                onClick={handleZoomOut}
                disabled={!zoomLimits.canZoomOut}
              />
              <MapControlButton
                label={mapText(dict, 'map.resetBearing')}
                icon={Compass}
                iconRef={compassRef}
                onClick={handleResetBearing}
              />
              <MapControlButton
                label={t(dict, 'map.resetView')}
                icon={Maximize}
                onClick={handleResetView}
              />
              <MapControlButton
                label={t(dict, 'map.locate')}
                icon={locateState === 'busy' ? LoaderCircle : LocateFixed}
                onClick={handleLocate}
                disabled={locateState === 'busy'}
                className={locateState === 'busy' ? '[&_svg]:animate-spin' : undefined}
              />
            </div>
          ) : null}

          {/* Always visible, never behind a toggle: OpenStreetMap's licence
              requires the credit to be shown wherever the tiles are. The
              linked version, and the data attribution, are in the legend where
              there is room to read them. */}
          <p className="bg-surface/85 text-muted-foreground absolute bottom-0 left-0 z-20 rounded-tr-sm px-2 py-1 text-[11px] leading-tight backdrop-blur-sm">
            {t(dict, 'map.attributionBasemap')}
          </p>

          <p id={hintId} className="sr-only">
            {t(dict, 'map.keyboardHint')}
          </p>

          {/* One polite live region for the geolocation control. Nothing else
              announces itself: the map must not chatter while it is panned. */}
          <p role="status" aria-live="polite" className="sr-only">
            {locateMessage}
          </p>

          {markerHosts.map(({ id: stationId, element }) => {
            const row = rowsByStation.get(stationId);
            if (!row) return null;

            return createPortal(
              <StationMarker
                row={row}
                selected={stationId === selection}
                onSelect={handleSelect}
                dict={dict}
              />,
              element,
              stationId,
            );
          })}
        </div>
      )}

      {showLegend ? <MapLegend pollutant={pollutant} dict={dict} id={`${id}-legend`} /> : null}
    </div>
  );
}

export default AirQualityMap;
