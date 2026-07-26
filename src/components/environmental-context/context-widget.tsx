import { ChevronDown, Wind } from 'lucide-react';

import type { EnrichedContextEvent, SourceRef } from '@/lib/environmental-context/types';
import {
  DATE_PATTERNS,
  formatInMalta,
  formatNumber,
  getDictionary,
  t,
  toDateTimeAttribute,
  type Dictionary,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';
import { localised } from '@/components/charts/localised';
import { EventCard } from './event-card';
import { SourceLink } from './source-link';

/**
 * "What's affecting the air?"
 *
 * Three rules govern this panel.
 *
 * **It disappears when it has nothing to say.** No events means no panel — not
 * an empty box, and certainly not a plausible-sounding story generated to fill
 * the space. The environmental-context service returns silence when its
 * providers fail, and silence is what gets rendered.
 *
 * **At most three events lead.** Relevance ranking has already put the most
 * important first; showing all twenty would bury them. The rest are one
 * disclosure away.
 *
 * **No JavaScript.** The collapse and the "view all" are `<details>` elements,
 * so the panel is keyboard-operable, works before hydration, and prints open on
 * a page a reader has expanded. On narrow screens the leading cards become a
 * snap-scrolling row; the row is focusable so it can be scrolled from the
 * keyboard as well as swiped.
 */

export type ContextWidgetProps = {
  events: EnrichedContextEvent[];
  /** When maqua.app last retrieved the underlying model runs. ISO-8601 UTC. */
  fetchedAt: string;
  sources: SourceRef[];
  /**
   * What is missing, in a finished sentence.
   *
   * A provider that did not answer contributes no events, and saying so is
   * better than letting a shorter list read as "there is less going on".
   */
  partialNote?: string;
  /** How many events lead before the disclosure. */
  maxPrimary?: number;
  headingId?: string;
  dict?: Dictionary;
  className?: string;
};

export function ContextWidget({
  events,
  fetchedAt,
  sources,
  partialNote,
  maxPrimary = 3,
  headingId = 'context-heading',
  dict = getDictionary(),
  className,
}: ContextWidgetProps) {
  // Nothing to report. Render nothing at all rather than an empty shell that
  // reads as "we checked and the air is fine" — which is not what it means.
  if (events.length === 0) return null;

  const primary = events.slice(0, maxPrimary);
  const remainder = events.slice(maxPrimary);
  const retrievedAt = toDateTimeAttribute(fetchedAt);

  return (
    <section
      aria-labelledby={headingId}
      className={cn('rounded-panel border-border bg-surface-sunken border', className)}
    >
      <details open className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
          <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
            <Wind className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            {localised(dict, 'context.affectingTitle', "What's affecting the air?")}
            <span className="text-muted-foreground text-sm font-normal">
              ({formatNumber(events.length, 0, dict)})
            </span>
          </h2>
          <ChevronDown
            className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>

        <div className="flex flex-col gap-3 px-4 pb-4">
          <p className="text-muted-foreground text-xs leading-relaxed">
            {localised(
              dict,
              'context.scopeNote',
              'Conditions across the Maltese Islands that may be influencing air quality. Context explains a reading; it never adjusts one, and it does not establish the cause of any individual measurement.',
            )}
          </p>

          {/*
            A scrollable region needs to be reachable from the keyboard, so the
            wrapper takes focus and an accessible name. On wide screens it stops
            scrolling and becomes a stack, and the tab stop costs nothing.
          */}
          <div
            tabIndex={0}
            role="group"
            aria-label={localised(dict, 'context.listLabel', 'Leading environmental conditions')}
            className="-mx-1 overflow-x-auto px-1 pb-1 lg:overflow-visible"
          >
            <ul className="flex snap-x snap-mandatory gap-3 lg:snap-none lg:flex-col">
              {primary.map((event) => (
                <li
                  key={event.id}
                  className="w-[85%] shrink-0 snap-start sm:w-[60%] lg:w-auto lg:shrink"
                >
                  <EventCard event={event} dict={dict} className="h-full" />
                </li>
              ))}
            </ul>
          </div>

          {remainder.length > 0 ? (
            <details className="group/all">
              <summary className="text-primary inline-flex min-h-11 cursor-pointer items-center gap-1 text-sm font-medium underline decoration-from-font underline-offset-4">
                {t(dict, 'common.viewAll')}
                <span className="text-muted-foreground">
                  ({formatNumber(remainder.length, 0, dict)})
                </span>
              </summary>
              <ul className="mt-3 flex flex-col gap-3">
                {remainder.map((event) => (
                  <li key={event.id}>
                    <EventCard event={event} dict={dict} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="border-border flex flex-col gap-1 border-t pt-3">
            {sources.map((source) => (
              <SourceLink
                key={source.name}
                name={source.name}
                url={source.url}
                prefix={localised(dict, 'common.sourcePrefix', 'Source:')}
                dict={dict}
              />
            ))}

            {partialNote ? <p className="text-muted-foreground text-xs">{partialNote}</p> : null}

            {retrievedAt ? (
              <p className="text-muted-foreground text-xs">
                {t(dict, 'freshness.retrievedAtLabel')}{' '}
                <time dateTime={retrievedAt} className="tabular">
                  {formatInMalta(fetchedAt, DATE_PATTERNS.dateTime, dict)}
                </time>
              </p>
            ) : null}
          </div>
        </div>
      </details>
    </section>
  );
}
