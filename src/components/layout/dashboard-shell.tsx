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
const MAP_HEIGHT = 'h-[60vh] min-h-[24rem] lg:h-[36rem] xl:h-[42rem]';

const AirQualityMap = dynamic(
  () => import('@/components/map/air-quality-map').then((module) => module.AirQualityMap),
  {
    ssr: false,
    /* The same height as the map itself, or the page reflows the moment the
       chunk lands. Shared constant rather than a repeated string precisely
       because the two drifted apart before. */
    loading: () => <MapLoading heightClassName={MAP_HEIGHT} />,
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
  /** The islands-wide headline, including the band's one-sentence advice. */
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
      /* The headline above already gives health guidance, taken from the worst
         reporting station and so never laxer than this one's. Rendering the
         panel's copy too printed the same paragraphs twice on one screen. */
      showGuidance={false}
      /* A preview, not the dossier. See `StationPanel`'s `detail` prop: at
         `full` this ran to roughly 2,200px in a 384px column and had to be
         given its own scrollbar. Everything dropped here is one click away
         through the "View details" link the panel still ends with. */
      detail="summary"
      dict={dict}
    />
  ) : (
    <p className="text-muted-foreground rounded-card border-border bg-surface border p-4 text-sm leading-relaxed">
      {t(dict, 'station.selectPrompt')}
    </p>
  );

  return (
    <main id="main" className="flex flex-1 flex-col">
      {/* --- Headline, always server-rendered and always first -------------
          Drawn on its own surface with a rule beneath it, so the page opens
          with one clearly-bounded answer instead of a stack of same-weight
          cards.

          The h1 leads and the danger banner follows it. The banner expands on
          the same facts the headline states, and opening the page with a
          screen-high striped box pushed the actual answer below the fold; as a
          `role="alert"` region it is announced on arrival regardless of where
          it sits in the column. */}
      {/* Tight vertical rhythm on purpose: with the alert as a strip rather
          than a dossier, the whole headline band fits in well under half a
          laptop viewport and the map's top edge is visible without scrolling —
          the reader gets the answer AND the instrument in one glance. */}
      <div className="border-border bg-surface border-b">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
          {serviceStatus}
          {summary}
          {banner}
        </div>
      </div>

      <Tabs
        value={view}
        onValueChange={(next) => setView(next === 'list' ? 'list' : 'map')}
        /* Wider than the headline band on purpose: the map is the workbench and
           earns more of the viewport than the prose does. Below ~96rem the two
           share the same gutters, so nothing misaligns on ordinary screens. */
        className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8"
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
          {/* `items-start`, not the default `stretch`: a stretched grid item
              cannot be `position: sticky`, and the sidebar below depends on
              being able to stick. It also means the row is sized by the taller
              column honestly rather than by a stretch nobody can see. */}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
            {/* `min-w-0` is load-bearing. This is a grid item, and a grid item's
                default `min-width: auto` refuses to shrink below its content's
                max-content width — which, thanks to the snap-scrolling station
                row below, is five 17rem cards wide. The `lg:` column template
                says `minmax(0,1fr)` and so is already safe; the implicit single
                column below `lg` is not, and without this the whole page scrolls
                sideways on a phone. */}
            <div className="flex min-w-0 flex-col gap-4">
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
                /* A definite height at every width. `lg:h-full` used to be here,
                   resolving against a grid item whose own height came from its
                   content — circular, so the map silently fell back to auto and
                   never filled the row. The sidebar no longer drives the row
                   height either, so there is nothing left to fill. */
                heightClassName={MAP_HEIGHT}
                dict={dict}
              />

              <MapLegend pollutant={pollutant} headingLevel={2} dict={dict} />
            </div>

            {/* --- Sidebar (wide screens only) ----------------------------
                The selected station and nothing else. The islands-wide
                guidance, context and forecast used to sit here too, and between
                them they were several times taller than the map column beside
                them — so the page ran for thousands of pixels with a single
                22rem column of content and an empty half-width gutter to its
                left. They are full-width sections below the grid now. */}
            <aside
              aria-label={t(dict, 'a11y.complementary')}
              /* Pinned beside the map, and NOT a scrolling region.
                 It used to be one: the panel rendered the full station dossier
                 — every pollutant at reading size, the EU-limit comparison, the
                 site metadata — which came to some 2,200px in this 384px
                 column, so it was capped to the viewport and given
                 `overflow-y-auto`. That traded a layout problem for a worse
                 visual one, a widget with its own scrollbar sitting beside the
                 map. The panel is passed `detail="summary"` instead and now
                 fits, so there is nothing to cap and no scrollbar to look at.
                 No `tabIndex` either: that only existed because a scroll
                 container which answers to a mouse wheel alone is unreachable
                 from a keyboard. With no scroll container there is nothing to
                 scroll, and a focusable wrapper around static content is one
                 more stop on the way to the links inside it.
                 `top-20` clears the sticky site header. */
              className="hidden min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:flex"
            >
              {stationPanel}
            </aside>
          </div>

          {/* The station row, full width beneath the map and its sidebar.
              Shown at every width, and deliberately so. On a phone it is the
              swipe affordance that reaches a station without hitting a marker;
              on a desktop it is what a reader with JavaScript disabled sees,
              since the map never loads for them and the list view sits behind
              a tab control that needs scripting. Every station therefore
              appears in the server-rendered HTML.

              Below `md` it is a snap-scrolling row — a swipe is how a thumb
              browses five cards. From `md` up it becomes a wrap grid instead:
              the cards all fit, so a horizontal scrollbar under the map was a
              scrollbar with nothing to scroll for, and the fifth station was
              clipped at the viewport edge as if the network had four and a
              half members. It once lived inside the map column, where five
              17rem cards could never fit; at full shell width they do.
              The container keeps `tabIndex` for the widths where it still
              scrolls, so it can be panned from the keyboard as well as by
              touch. */}
          <div>
            <h2 className="text-muted-foreground eyebrow mb-2.5">
              {t(dict, 'station.allStations')}
            </h2>
            <ul
              tabIndex={0}
              aria-label={t(dict, 'station.allStations')}
              /* `relative` for the same reason as the list table: these
                 cards carry absolutely-positioned `sr-only` pollutant
                 labels, which escape the clip without a containing block
                 here. */
              className="relative flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-3 md:gap-4 md:overflow-x-visible md:pb-0 xl:grid-cols-5"
            >
              {entries.map((entry) => (
                <li key={entry.station.id} className="w-[17rem] shrink-0 snap-start md:w-auto">
                  <StationCard
                    station={entry.station}
                    reading={entry.reading}
                    pollutant={pollutant}
                    headingLevel="h3"
                    dict={dict}
                    className={cn('h-full', entry.station.id === selectedId && 'ring-ring ring-2')}
                  />
                </li>
              ))}
            </ul>
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
        </TabsContent>
      </Tabs>

      {/* --- Islands-wide panels ------------------------------------------
          Outside both tab panels, because neither depends on the view: the
          context and the forecast describe the islands, not the way the
          stations happen to be displayed. Rendering them once here keeps the
          two tabs consistent, stops the forecast remounting on every toggle,
          and means a phone in map view sees them at all — they once lived in a
          `hidden lg:flex` sidebar and were absent below `lg`.

          The guidance leads, because it is the one a reader acts on; the
          context follows beside it in a narrower column, and the forecast runs
          the full width beneath — a 48-hour outlook is a timeline, and a
          timeline wants the horizontal room the two panels above it do not.
          Three equal columns gave all three the same weight, which none of
          them share. The guidance's opening sentence is already under the
          headline, so its panel starts at "for most people" rather than
          repeating itself.

          `grid-cols-1` is not redundant. Tailwind expands it to
          `repeat(1,minmax(0,1fr))`, and it is that explicit 0 floor that
          matters: with no base column declared, the implicit track is `auto`,
          which will not shrink an item below its content's max-content width —
          and these panels contain snap-scrolling rows far wider than a phone.
          Same bug as the map column above. */}
      <div className="border-border bg-surface-sunken/60 border-t">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-start gap-5 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          {guidance}
          {context}
          {forecast ? <div className="lg:col-span-2">{forecast}</div> : null}
        </div>
      </div>

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
