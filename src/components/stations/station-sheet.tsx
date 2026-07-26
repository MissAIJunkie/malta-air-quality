'use client';

import type * as React from 'react';

import { StationPanel } from '@/components/stations/station-panel';
import { islandLabel, type StationDescriptor } from '@/components/stations/types';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  type SheetSide,
} from '@/components/ui/sheet';
import type { PollutantCode } from '@/config/pollutants';
import type { StationReading } from '@/lib/air-quality/types';
import { getDictionary, t, type Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

export type StationSheetProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  station: StationDescriptor;
  /** `null` when the station published nothing usable for this hour. */
  reading: StationReading | null | undefined;
  /** Pollutants the station is expected to report. See `StationPanel`. */
  expectedPollutants?: readonly PollutantCode[];
  /** Link to the station's full page. */
  href?: string;
  /** `bottom` on touch, `right` where there is width to spare. */
  side?: SheetSide;
  /** Optional element that opens the sheet. Omit when driving `open` yourself. */
  trigger?: React.ReactNode;
  dict?: Dictionary;
  className?: string;
};

/**
 * The station panel as a modal sheet, for opening from a map marker.
 *
 * Three details make this usable on a phone:
 *
 * The bottom padding clears the iOS home indicator. `max()` rather than a plain
 * addition, so the panel keeps its normal padding on every device that reports
 * no inset, and grows only where there is something to clear.
 *
 * The panel's danger banner does not announce itself here. Radix already moves
 * focus into the sheet and announces its title on open; a `role="alert"`
 * inserted at the same instant would cut that announcement off mid-sentence.
 * The banner is still rendered, still first in the reading order, and still
 * unmissable — it simply does not interrupt.
 *
 * The sheet's own title carries the station name, so the panel's header is
 * suppressed rather than repeating it as a second visible heading.
 */
export function StationSheet({
  open,
  onOpenChange,
  station,
  reading,
  expectedPollutants,
  href,
  side = 'bottom',
  trigger,
  dict = getDictionary(),
  className,
}: StationSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}

      <SheetContent
        side={side}
        closeLabel={t(dict, 'common.close')}
        className={cn(
          side === 'bottom' && 'rounded-t-panel max-h-[88dvh]',
          // Clears the iOS home indicator without shrinking the padding
          // anywhere that reports no inset.
          'pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          'pl-[max(1.5rem,env(safe-area-inset-left))]',
          'pr-[max(1.5rem,env(safe-area-inset-right))]',
          className,
        )}
      >
        {side === 'bottom' ? (
          <div
            aria-hidden="true"
            className="bg-border mx-auto -mt-2 mb-1 h-1 w-10 shrink-0 rounded-full"
          />
        ) : null}

        <SheetHeader>
          <SheetTitle>{station.name}</SheetTitle>
          <SheetDescription>
            {station.locality}
            {t(dict, 'common.separator')}
            {islandLabel(station.island, dict)}
          </SheetDescription>
        </SheetHeader>

        <StationPanel
          station={station}
          reading={reading}
          expectedPollutants={expectedPollutants}
          href={href}
          showHeader={false}
          announceDanger={false}
          // The suppressed header would have been the h2; keeping the level
          // here puts the panel's sub-headings at h3, directly below the
          // SheetTitle, with no skipped level in the outline.
          headingLevel="h2"
          dict={dict}
        />
      </SheetContent>
    </Sheet>
  );
}
