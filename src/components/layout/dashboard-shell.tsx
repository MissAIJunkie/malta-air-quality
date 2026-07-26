'use client';

import { List, Map as MapIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState, type ReactNode } from 'react';

import { MapLegend } from '@/components/map/map-legend';
import { MapLoading } from '@/components/map/map-loading';
import { OVERALL_FILTER, type PollutantFilterValue } from '@/components/pollutants/filter-value';
import { PollutantFilter } from '@/components/pollutants/pollutant-filter';
import { StationCard } from '@/components/stations/station-card';
import { StationList } from '@/components/stations/station-list';
import { StationPanel } from '@/components/stations/station-panel';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { PollutantCode } from '@/config/pollutants';
import type { StationEntry } from '@/components/stations/types';
import type { MapStation } from '@/lib/map/markers';
import type { StationReading } from '@/lib/air-quality/types';
import { getDictionary, hasKey, t } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

/**
 * The map is the only part of this page that cannot be server-rendered.
 *
 * MapLibre needs a real canvas and a WebGL context, so it is loaded on the
 * client with `ssr: false` and a skeleton of the same height. Everything the
 * map shows — every station, every band, every reading — is also present in the
 * list view, which IS server-rendered, so a reader whose map never loads has
 * lost a convenience rather than the information.
 */
const AirQualityMap = dynamic(
  () => import('@/components/map/air-quality-map').then((module) => module.AirQualityMap),
  {
    ssr: false,
    loading: () => <MapLoading heightClassName="h-[60vh] min-h-[24rem] lg:h-full" />,
  },
);

export type DashboardShellProps = {
  entries: StationEntry[];
  mapStations: MapStation[];
  readings: StationReading[];
  /** Pollutants that actually reported a value this hour. */
  available: PollutantCode[];
  /** Station whose reading drove the islands-wide headline, if any. */
  drivingStationId: string | null;
  /** Expected pollutants per station id, for the "not measured here" states. */
  expectedByStation: Record<string, PollutantCode[]>;

  /* Server-rendered regions, passed as slots. They do not depend on any client
     state, so rendering them here would move work into the browser for nothing. */
  banner?: ReactNode;
  summary: ReactNode;
  serviceStatus?: ReactNode;
  context?: ReactNode;
  forecast?: ReactNode;
  guidance?: ReactNode;
};

type ViewMode = 'map' | 'list';

/**
 * The map-first dashboard.
 *
 * Holds exactly three pieces of state — which view is showing, which pollutant
 * is selected, and which station is open — and nothing else. Every component it
 * arranges belongs to another part of the application and is rendered with the
 * data it asks for; no air-quality logic lives in this file.
 *
 * Map and list are genuine equals rather than a primary view and a fallback.
 * The toggle is visible, keyboard-reachable and announced, because a map is
 * unusable to a screen-reader user and a page whose only accessible path is a
 * hidden fallback is a page that was designed for someone else.
 */
export function DashboardShell({
  entries,
  mapStations,
  readings,
  available,
  drivingStationId,
  expectedByStation,
  banner,
  summary,
  serviceStatus,
  context,
  forecast,
  guidance,
}: DashboardShellProps) {
  const dict = getDictionary();
  const copy = (key: string, fallback: string): string =>
    hasKey(dict, key) ? t(dict, key) : fallback;

  const [view, setView] = useState<ViewMode>('map');
  const [filter, setFilter] = useState<PollutantFilterValue>(OVERALL_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(drivingStationId);
  const [sheetOpen, setSheetOpen] = useState(false);

  /** The filter as the map, list and cards want it: a code, or null for overall. */
  const pollutant: PollutantCode | null = filter === OVERALL_FILTER ? null : filter;

  const selected = entries.find((entry) => entry.station.id === selectedId) ?? null;

  // No useCallback: the React Compiler memoises this, and a manual dependency
  // array here disagreed with the one it infers.
  const handleSelect = (stationId: string) => {
    setSelectedId(stationId);
    // The sheet is the narrow-screen presentation of the panel. On a wide screen
    // the same panel is already visible in the sidebar, and opening a dialog
    // over it would trap focus for no reason — so `sheetOpen` is only honoured
    // below `lg`, where the sheet is the only rendering of the panel.
    setSheetOpen(true);
  };

  const stationPanel = selected ? (
    <StationPanel
      station={selected.station}
      reading={selected.reading}
      expectedPollutants={expectedByStation[selected.station.id] ?? []}
      headingLevel="h3"
      /* The sidebar copy is a summary; the station's own page announces the
         danger banner, and two live regions for one event is noise. */
      announceDanger={false}
      dict={dict}
    />
  ) : (
    <p className="text-muted-foreground rounded-card border-border bg-surface border p-4 text-sm leading-relaxed">
      {t(dict, 'station.selectPrompt')}
    </p>
  );

  return (
    <main id="main" className="flex flex-1 flex-col">
      {/* --- Headline, always server-rendered and always first ------------- */}
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 pt-4 sm:px-6 sm:pt-6">
        {serviceStatus}
        {banner}
        {summary}
      </div>

      <Tabs
        value={view}
        onValueChange={(next) => setView(next === 'list' ? 'list' : 'map')}
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6"
      >
        {/* --- Controls --------------------------------------------------- */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <TabsList aria-label={copy('home.viewToggleLabel', 'Choose how to view the stations')}>
            <TabsTrigger value="map">
              <MapIcon className="size-4" aria-hidden="true" />
              {t(dict, 'map.viewAsMap')}
            </TabsTrigger>
            <TabsTrigger value="list">
              <List className="size-4" aria-hidden="true" />
              {t(dict, 'map.viewAsList')}
            </TabsTrigger>
          </TabsList>

          <PollutantFilter
            value={filter}
            onValueChange={setFilter}
            available={available}
            name="home-pollutant"
            dict={dict}
            className="lg:max-w-xl"
          />
        </div>

        {/* --- Map view --------------------------------------------------- */}
        <TabsContent value="map" className="flex flex-1 flex-col gap-4">
          <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="flex min-h-0 flex-col gap-4">
              <AirQualityMap
                readings={readings}
                stations={mapStations}
                pollutant={pollutant}
                selectedStationId={selectedId}
                onSelectStation={handleSelect}
                /* The legend is rendered once, beneath the map, rather than
                   floating over it: an overlay covers the islands on a phone,
                   which is the whole of the map at that size. */
                showLegend={false}
                heightClassName="h-[60vh] min-h-[24rem] lg:h-full"
                dict={dict}
              />

              {/* A snap-scrolling row of stations under the map.
                  Shown at every width, and deliberately so. On a phone it is the
                  swipe affordance that reaches a station without hitting a
                  marker; on a desktop it is what a reader with JavaScript
                  disabled sees, since the map never loads for them and the list
                  view sits behind a tab control that needs scripting. Every
                  station therefore appears in the server-rendered HTML.
                  The scroll container is focusable so it can be panned from the
                  keyboard as well as by touch. */}
              <div>
                <h2 className="text-foreground mb-2 text-sm font-semibold">
                  {t(dict, 'station.allStations')}
                </h2>
                <ul
                  tabIndex={0}
                  aria-label={t(dict, 'station.allStations')}
                  className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
                >
                  {entries.map((entry) => (
                    <li key={entry.station.id} className="w-[17rem] shrink-0 snap-start">
                      <StationCard
                        station={entry.station}
                        reading={entry.reading}
                        pollutant={pollutant}
                        headingLevel="h3"
                        dict={dict}
                        className={cn(
                          'h-full',
                          entry.station.id === selectedId && 'ring-ring ring-2',
                        )}
                      />
                    </li>
                  ))}
                </ul>
              </div>

              <MapLegend pollutant={pollutant} headingLevel={2} dict={dict} />
            </div>

            {/* --- Sidebar (wide screens only) ---------------------------- */}
            <aside
              aria-label={t(dict, 'a11y.complementary')}
              className="hidden min-w-0 flex-col gap-4 lg:flex"
            >
              {stationPanel}
              {guidance}
              {context}
              {forecast}
            </aside>
          </div>
        </TabsContent>

        {/* --- List view -------------------------------------------------- */}
        <TabsContent value="list" className="flex flex-1 flex-col gap-6">
          <StationList
            entries={entries}
            pollutant={pollutant}
            caption={t(dict, 'map.listFallbackHeading')}
            dict={dict}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            {guidance}
            {context}
            {forecast}
          </div>
        </TabsContent>
      </Tabs>

      {/* --- Narrow-screen station detail ------------------------------- */}
      <div className="lg:hidden">
        <Sheet open={sheetOpen && selected !== null} onOpenChange={setSheetOpen}>
          <SheetContent
            side="bottom"
            closeLabel={t(dict, 'common.close')}
            className="max-h-[85dvh]"
          >
            <SheetHeader>
              <SheetTitle>{selected?.station.name ?? t(dict, 'station.panelTitle')}</SheetTitle>
            </SheetHeader>
            {stationPanel}
          </SheetContent>
        </Sheet>
      </div>
    </main>
  );
}
