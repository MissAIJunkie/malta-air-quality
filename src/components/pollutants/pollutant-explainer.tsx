import type * as React from 'react';

import { averagingPeriodLabel } from '@/components/pollutants/pollutant-value';
import { Badge } from '@/components/ui/badge';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { POLLUTANTS, type PollutantCode } from '@/config/pollutants';
import { getDictionary, t, type Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

type HeadingLevel = 'h2' | 'h3' | 'h4';

const SUB_HEADING: Record<HeadingLevel, 'h3' | 'h4' | 'h5'> = {
  h2: 'h3',
  h3: 'h4',
  h4: 'h5',
};

export type PollutantExplainerProps = Omit<React.ComponentProps<'section'>, 'children'> & {
  pollutant: PollutantCode;
  /** Match the surrounding outline. Sub-headings follow one level below. */
  headingLevel?: HeadingLevel;
  dict?: Dictionary;
};

/**
 * Plain-language reference for one pollutant.
 *
 * Every string comes from the keys named in `src/config/pollutants.ts`, so the
 * registry stays the single place that decides which copy describes which
 * pollutant. Nothing here is computed: this is background reading that sits
 * beside a measurement, not an interpretation of one.
 */
export function PollutantExplainer({
  pollutant,
  headingLevel = 'h3',
  dict = getDictionary(),
  className,
  ...props
}: PollutantExplainerProps) {
  const definition = POLLUTANTS[pollutant];
  const Heading = headingLevel;
  const SubHeading = SUB_HEADING[headingLevel];

  // `pollutant.<slug>.name` is the plain-language name ("Fine particulate
  // matter"); the formula is shown beside it as a chip rather than as the
  // heading, so the heading reads well when announced on its own.
  const name = t(dict, `pollutant.${definition.slug}.name`);

  const sections = [
    { key: 'pollutant.whatIsIt', body: definition.descriptionKey },
    { key: 'pollutant.whereFrom', body: definition.sourcesKey },
    { key: 'pollutant.healthEffects', body: definition.healthEffectsKey },
  ];

  return (
    <section
      data-slot="pollutant-explainer"
      data-pollutant={pollutant}
      className={cn('flex flex-col gap-4', className)}
      {...props}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Heading className="text-lg leading-tight font-semibold">{name}</Heading>
        <Badge variant="outline" size="sm">
          <span aria-hidden="true">{definition.label}</span>
          <VisuallyHidden>{definition.ariaLabel}</VisuallyHidden>
        </Badge>
      </div>

      {sections.map((section) => (
        <div key={section.key} className="flex flex-col gap-1">
          <SubHeading className="text-sm font-semibold">{t(dict, section.key)}</SubHeading>
          <p className="text-muted-foreground text-sm leading-relaxed">{t(dict, section.body)}</p>
        </div>
      ))}

      <dl className="border-border flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-sm">
        <div className="flex flex-col">
          <dt className="text-muted-foreground text-xs font-medium">
            {t(dict, 'pollutant.averagingPeriod')}
          </dt>
          <dd>{averagingPeriodLabel(definition.averagingPeriod, dict)}</dd>
        </div>

        {/* The written name is the term and the symbol is its definition, so
            the pair explains itself without a screen reader having to spell
            out "µg/m³" unaided. */}
        <div className="flex flex-col">
          <dt className="text-muted-foreground text-xs font-medium">
            {t(dict, 'unit.microgramsPerCubicMetreLong')}
          </dt>
          <dd className="tabular">{definition.unit}</dd>
        </div>
      </dl>
    </section>
  );
}
