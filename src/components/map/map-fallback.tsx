import { MonitorX, TriangleAlert, WifiOff } from 'lucide-react';
import type * as React from 'react';

import { CategoryBadge } from '@/components/air-quality/category-badge';
import { FreshnessIndicator } from '@/components/air-quality/freshness-indicator';
import type { PollutantCode } from '@/config/pollutants';
import type { StationReading } from '@/lib/air-quality/types';
import { buildStationRows, type MapStation, type MapStationRow } from '@/lib/map/markers';
import { formatConcentration, getDictionary, t, type Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

/**
 * Why the map is not being shown.
 *
 * Both paths lead to the same place — the station list — but they are recorded
 * separately so the reason is visible in the DOM and in any diagnostics.
 */
export type MapFallbackReason = 'webgl' | 'tiles';

export type MapFallbackProps = Omit<React.ComponentProps<'section'>, 'children'> & {
  stations: readonly MapStation[];
  readings: readonly StationReading[];
  reason: MapFallbackReason;
  pollutant?: PollutantCode | null;
  selectedStationId?: string | null;
  onSelectStation?: (stationId: string) => void;
  headingLevel?: 2 | 3 | 4;
  dict?: Dictionary;
};

const REASON_ICONS: Record<MapFallbackReason, typeof TriangleAlert> = {
  webgl: MonitorX,
  tiles: WifiOff,
};

/**
 * What the page shows when there is no map.
 *
 * The map is a convenience, not the data. When WebGL is unavailable, or the
 * tile server never answers, the reader still gets every station, in the same
 * order the markers would have used, with the same band, the same caveats and
 * the same timestamps.
 *
 * It renders a LIST, not an error. "Something went wrong" would be a dead end;
 * a list is the information the reader came for, with a one-line explanation of
 * why it is not on a map.
 *
 * A server component. It is also what the page can render on its own when it
 * chooses not to load the map at all.
 */
export function MapFallback({
  stations,
  readings,
  reason,
  pollutant = null,
  selectedStationId = null,
  onSelectStation,
  headingLevel = 3,
  dict = getDictionary(),
  className,
  id = 'map-fallback',
  ...props
}: MapFallbackProps) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const ListHeading = `h${Math.min(headingLevel + 1, 4)}` as 'h3' | 'h4';
  const headingId = `${id}-heading`;

  const rows = buildStationRows(stations, readings, pollutant);
  const ReasonIcon = REASON_ICONS[reason];

  return (
    <section
      data-slot="map-fallback"
      data-reason={reason}
      id={id}
      aria-labelledby={headingId}
      className={cn('rounded-card border-border bg-surface shadow-card border p-4', className)}
      {...props}
    >
      <div className="flex items-start gap-3">
        <ReasonIcon className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <Heading id={headingId} className="text-base font-semibold">
            {t(dict, 'map.unavailable')}
          </Heading>
          <p className="text-muted-foreground mt-1 text-sm">{t(dict, 'map.unavailableHint')}</p>
        </div>
      </div>

      <ListHeading className="text-muted-foreground mt-5 text-sm font-semibold">
        {t(dict, 'map.listFallbackHeading')}
      </ListHeading>

      <ul className="divide-border mt-2 divide-y">
        {rows.map((row) => (
          <li key={row.station.id}>
            <StationRow
              row={row}
              selected={row.station.id === selectedStationId}
              onSelectStation={onSelectStation}
              dict={dict}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

type StationRowProps = {
  row: MapStationRow;
  selected: boolean;
  onSelectStation?: (stationId: string) => void;
  dict: Dictionary;
};

/**
 * One station.
 *
 * Interactive only when the caller supplied a handler. Rendering an inert
 * button would promise an action that does not happen, so without a handler
 * this is plain content — still complete, just not clickable.
 */
function StationRow({ row, selected, onSelectStation, dict }: StationRowProps) {
  const { station, category, subIndex, value, unit, modelled, pollutantMissing } = row;

  const body = (
    <>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{station.name}</span>
        <span className="text-muted-foreground text-xs">
          {station.locality}
          <span aria-hidden="true">{t(dict, 'common.separator')}</span>
          <span className="sr-only">, </span>
          {t(dict, station.island === 'Gozo' ? 'station.island.gozo' : 'station.island.malta')}
        </span>
        <FreshnessIndicator
          freshness={row.freshness}
          measuredAt={row.measuredAt}
          fetchedAt={row.fetchedAt}
          ageHours={row.ageHours}
          className="mt-0.5"
        />
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <CategoryBadge
          category={category}
          subIndex={subIndex}
          size="sm"
          srPrefix={station.name}
          dict={dict}
        />
        {pollutantMissing ? (
          <span className="text-muted-foreground text-xs">{t(dict, 'common.notMeasured')}</span>
        ) : value !== null && unit ? (
          <span className="tabular text-muted-foreground text-xs">
            {formatConcentration(value, unit, dict)}
          </span>
        ) : null}
        {modelled ? (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
            {t(dict, 'common.estimated')}
          </span>
        ) : null}
      </span>
    </>
  );

  const layout = 'flex w-full items-start justify-between gap-3 py-3 text-left';

  if (!onSelectStation) {
    return <span className={layout}>{body}</span>;
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelectStation(station.id)}
      className={cn(
        layout,
        'hover:bg-muted min-h-11 cursor-pointer rounded-sm px-1 transition-colors',
        selected && 'bg-muted',
      )}
    >
      {body}
    </button>
  );
}

export default MapFallback;
