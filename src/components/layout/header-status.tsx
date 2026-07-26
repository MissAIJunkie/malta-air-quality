'use client';

import { useQuery } from '@tanstack/react-query';

import { CategoryBadge } from '@/components/air-quality/category-badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { AirQualityCategory } from '@/config/thresholds';
import { ageInHours } from '@/lib/air-quality/freshness';
import {
  formatRelativeAge,
  formatTimeInMalta,
  getDictionary,
  t,
  toDateTimeAttribute,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

/**
 * The subset of `/api/air-quality` this component needs.
 *
 * Narrowed by hand rather than by reusing `MaltaSummary`: the response is
 * untrusted JSON at this boundary, so every field is checked before use. A
 * malformed payload must degrade to "status unavailable" and never to a
 * confident "Good".
 */
type SummaryShape = {
  category: AirQualityCategory | null;
  measuredAt: string | null;
  reportingStations: number;
  totalStations: number;
};

const CATEGORY_VALUES: readonly string[] = [
  'Good',
  'Fair',
  'Moderate',
  'Poor',
  'Very poor',
  'Extremely poor',
];

function parseSummary(payload: unknown): SummaryShape | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const summary = (data as { summary?: unknown }).summary;
  if (typeof summary !== 'object' || summary === null) return null;

  const record = summary as Record<string, unknown>;
  const category = typeof record.category === 'string' ? record.category : null;

  return {
    // An unrecognised band name becomes "no data" rather than being trusted.
    category:
      category !== null && CATEGORY_VALUES.includes(category)
        ? (category as AirQualityCategory)
        : null,
    measuredAt: typeof record.measuredAt === 'string' ? record.measuredAt : null,
    reportingStations: typeof record.reportingStations === 'number' ? record.reportingStations : 0,
    totalStations: typeof record.totalStations === 'number' ? record.totalStations : 0,
  };
}

async function fetchSummary(): Promise<SummaryShape | null> {
  const response = await fetch('/api/air-quality', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Air-quality request failed: ${response.status}`);
  return parseSummary(await response.json());
}

/**
 * Malta-wide status in the header.
 *
 * Client-side on purpose. The header sits in the root layout, which every page
 * shares, and `getLatestReadings()` reaches the network — fetching it there
 * would put an upstream request in front of /about and /privacy, and a failure
 * would escape the page-level error boundary. The header therefore asks our own
 * cached API, while the home page renders the same figures server-side, where
 * they are the substance of the page rather than a convenience.
 *
 * Two consequences, both deliberate. With JavaScript disabled this area stays
 * empty on the content pages — and the authoritative, no-JavaScript rendering
 * lives on the home page, so no reading exists only here. And the clock is only
 * read after mount, when the query has resolved, so server and client never
 * disagree about the age of a reading.
 */
export function HeaderStatus({ className }: { className?: string }) {
  const dict = getDictionary();
  const { data, isPending, isError } = useQuery({
    queryKey: ['air-quality', 'summary'],
    queryFn: fetchSummary,
  });

  if (isPending) {
    return (
      <div className={cn('flex items-center gap-2', className)} aria-hidden="true">
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="hidden h-3 w-24 sm:block" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className={cn('text-muted-foreground text-xs', className)} role="status">
        {t(dict, 'freshness.unavailable.label')}
      </p>
    );
  }

  const age = data.measuredAt ? ageInHours(data.measuredAt, new Date().toISOString()) : null;
  const measuredDateTime = toDateTimeAttribute(data.measuredAt);

  return (
    <div
      className={cn('flex min-w-0 items-center gap-2', className)}
      role="status"
      aria-live="polite"
    >
      <CategoryBadge category={data.category} size="sm" srPrefix={t(dict, 'header.overallLabel')} />

      <span className="text-muted-foreground hidden min-w-0 flex-col text-xs leading-tight sm:flex">
        {/* The timestamp and the age travel together: a time on its own does not
            tell a reader whether the figure still describes the present. */}
        <span className="truncate">
          {measuredDateTime ? (
            <>
              {t(dict, 'freshness.measuredAtLabel')}{' '}
              <time dateTime={measuredDateTime} className="tabular">
                {formatTimeInMalta(data.measuredAt, dict)}
              </time>{' '}
              <span aria-hidden="true">·</span> {formatRelativeAge(age, dict)}
            </>
          ) : (
            t(dict, 'errors.dataUnavailable')
          )}
        </span>
        <span className="truncate">
          {t(dict, 'header.reportingStations', {
            reporting: data.reportingStations,
            total: data.totalStations,
          })}
        </span>
      </span>
    </div>
  );
}
