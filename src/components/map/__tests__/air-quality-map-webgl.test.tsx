import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetWebGLProbe } from '@/lib/map/webgl';
import type { StationReading } from '@/lib/air-quality/types';

/**
 * The map, on the path a real browser takes.
 *
 * The sibling suite covers the fallback, which is what jsdom reaches on its own
 * because it has no WebGL. That leaves the headline feature verified in one
 * direction only: a probe that wrongly answered "unsupported" — or a map that
 * threw on construction — would show the station list to everyone and every
 * test would still pass.
 *
 * So this suite forces the probe to succeed and substitutes a fake
 * `maplibre-gl`, then asserts the component actually builds a map, points it at
 * Malta, and stops rendering the fallback. It verifies the wiring, not the
 * rendering; pixels need a GPU and belong in the end-to-end suite.
 */

const mapInstances: FakeMap[] = [];
const markerInstances: FakeMarker[] = [];

class FakeMap {
  readonly options: Record<string, unknown>;
  readonly handlers = new Map<string, Array<(event?: unknown) => void>>();
  readonly controls: unknown[] = [];
  removed = false;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    mapInstances.push(this);
  }

  on(event: string, handler: (event?: unknown) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    // MapLibre fires `load` asynchronously; mirroring that keeps the component's
    // real ordering assumptions under test.
    if (event === 'load') queueMicrotask(() => handler());
    return this;
  }

  once(event: string, handler: (event?: unknown) => void) {
    return this.on(event, handler);
  }

  off() {
    return this;
  }

  addControl(control: unknown) {
    this.controls.push(control);
    return this;
  }

  removeControl() {
    return this;
  }

  fitBounds() {
    return this;
  }

  // The component reads these straight after `load` to decide whether its zoom
  // controls should be enabled, so the fake has to answer them.
  getZoom() {
    return 11;
  }

  getMinZoom() {
    return 9;
  }

  getMaxZoom() {
    return 17;
  }

  zoomIn() {
    return this;
  }

  zoomOut() {
    return this;
  }

  setStyle() {
    return this;
  }

  getCanvas() {
    return document.createElement('canvas');
  }

  getContainer() {
    return document.createElement('div');
  }

  remove() {
    this.removed = true;
  }

  resize() {
    return this;
  }
}

class FakeMarker {
  element: HTMLElement | undefined;
  lngLat: [number, number] | undefined;

  constructor(options?: { element?: HTMLElement }) {
    this.element = options?.element;
    markerInstances.push(this);
  }

  setLngLat(value: [number, number]) {
    this.lngLat = value;
    return this;
  }

  addTo() {
    return this;
  }

  remove() {
    return this;
  }
}

vi.mock('maplibre-gl', () => ({
  default: {
    Map: FakeMap,
    Marker: FakeMarker,
    NavigationControl: class {},
    GeolocateControl: class {},
  },
  Map: FakeMap,
  Marker: FakeMarker,
  NavigationControl: class {},
  GeolocateControl: class {},
}));

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

const reading: StationReading = {
  stationId: 'MT00011',
  measuredAt: '2026-07-26T09:00:00.000Z',
  fetchedAt: '2026-07-26T10:00:00.000Z',
  timezone: 'Europe/Malta',
  overallCategory: 'Moderate',
  overallSubIndex: 3.4,
  dominantPollutant: 'PM10',
  pollutants: {
    PM10: {
      pollutant: 'PM10',
      value: 62,
      unit: 'µg/m³',
      category: 'Moderate',
      subIndex: 3.4,
      averagingPeriod: 'Hourly',
      thresholdReference: 'test',
      modelled: false,
    },
  },
  provisional: true,
  freshness: 'fresh',
  ageHours: 1,
  partial: false,
  source: 'FIXTURE',
};

describe('AirQualityMap with WebGL available', () => {
  beforeEach(() => {
    mapInstances.length = 0;
    markerInstances.length = 0;
    resetWebGLProbe();
    // Force the probe to report support. jsdom's canvas returns null for every
    // context, so without this the component can only ever take the fallback.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) =>
      contextId === 'webgl2'
        ? ({ getExtension: () => ({ loseContext: () => {} }) } as unknown)
        : null) as HTMLCanvasElement['getContext']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetWebGLProbe();
  });

  it('builds a map instead of falling back to the list', async () => {
    const { AirQualityMap } = await import('@/components/map/air-quality-map');
    render(<AirQualityMap readings={[reading]} />);

    await waitFor(() => expect(mapInstances).toHaveLength(1));

    expect(
      screen.queryByRole('region', { name: /could not be loaded/i }),
      'the fallback is still showing even though WebGL is available',
    ).toBeNull();
  });

  it('opens on Malta and Gozo rather than the wider Mediterranean', async () => {
    const { AirQualityMap } = await import('@/components/map/air-quality-map');
    render(<AirQualityMap readings={[reading]} />);

    await waitFor(() => expect(mapInstances).toHaveLength(1));
    const options = mapInstances[0].options;

    // Whether the viewport is set by bounds or by centre, it has to be Malta.
    const bounds = options.bounds as [[number, number], [number, number]] | undefined;
    const centre = options.center as [number, number] | undefined;

    if (bounds) {
      const [[west, south], [east, north]] = bounds;
      expect(west).toBeGreaterThan(14);
      expect(east).toBeLessThan(14.7);
      expect(south).toBeGreaterThan(35.7);
      expect(north).toBeLessThan(36.2);
    } else {
      expect(centre, 'the map has neither bounds nor a centre').toBeDefined();
      expect(centre![0]).toBeGreaterThan(14);
      expect(centre![0]).toBeLessThan(14.7);
      expect(centre![1]).toBeGreaterThan(35.7);
      expect(centre![1]).toBeLessThan(36.2);
    }
  });

  it('places one marker per station, at the configured coordinates', async () => {
    const { AirQualityMap } = await import('@/components/map/air-quality-map');
    const { STATIONS } = await import('@/config/stations');
    render(<AirQualityMap readings={[reading]} />);

    await waitFor(() => expect(markerInstances.length).toBeGreaterThan(0));
    await waitFor(() => expect(markerInstances).toHaveLength(STATIONS.length));

    for (const station of STATIONS) {
      const placed = markerInstances.some(
        (marker) =>
          marker.lngLat?.[0] === station.longitude && marker.lngLat?.[1] === station.latitude,
      );
      expect(placed, `no marker at ${station.name}'s verified coordinates`).toBe(true);
    }
  });

  it('tears the map down on unmount so a remount cannot leak a GPU context', async () => {
    const { AirQualityMap } = await import('@/components/map/air-quality-map');
    const { unmount } = render(<AirQualityMap readings={[reading]} />);

    await waitFor(() => expect(mapInstances).toHaveLength(1));
    unmount();

    await waitFor(() => expect(mapInstances[0].removed).toBe(true));
  });
});
