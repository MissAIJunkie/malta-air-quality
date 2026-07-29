import { Info } from 'lucide-react';
import type * as React from 'react';

import { isElevatedCategory, type AirQualityCategory } from '@/config/thresholds';
import {
  SENSITIVE_GROUPS,
  categoryHealthKey,
  categoryShortAdviceKey,
  getDictionary,
  sensitiveGroupAdviceKey,
  sensitiveGroupLabelKey,
  t,
  type Dictionary,
  type SensitiveGroup,
} from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

type HeadingLevel = 'h2' | 'h3' | 'h4';

const SUB_HEADING: Record<HeadingLevel, 'h3' | 'h4' | 'h5'> = {
  h2: 'h3',
  h3: 'h4',
  h4: 'h5',
};

/**
 * The medical disclaimer, verbatim.
 *
 * A component rather than a copied string so that every surface carrying health
 * guidance carries exactly the same wording. Required by the brief wherever
 * advice appears — `HealthGuidance` and `DangerBanner` both render it, and
 * neither offers a way to turn it off.
 */
export function MedicalDisclaimer({
  dict = getDictionary(),
  className,
  ...props
}: Omit<React.ComponentProps<'p'>, 'children'> & { dict?: Dictionary }) {
  return (
    <p
      data-slot="medical-disclaimer"
      className={cn(
        'text-muted-foreground flex items-start gap-2 text-xs leading-relaxed',
        className,
      )}
      {...props}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{t(dict, 'disclaimer.medical')}</span>
    </p>
  );
}

export type HealthGuidanceProps = Omit<React.ComponentProps<'section'>, 'children'> & {
  /** `null` renders the "no reading, so no advice" state, never a default of Good. */
  category: AirQualityCategory | null | undefined;
  headingLevel?: HeadingLevel;
  /**
   * `brief` names the sensitive groups; `full` adds why each one is listed.
   * Defaults to `full` for the bands that warrant a warning.
   */
  detail?: 'brief' | 'full';
  /**
   * Show the band's one-sentence summary at the top of the panel.
   *
   * Set false where the page has already given it — the home page prints it
   * under the headline, and without this the same sentence appeared twice on
   * one screen. The rest of the panel is unaffected; nothing else is optional.
   */
  showLead?: boolean;
  dict?: Dictionary;
};

/**
 * Cautious, general, non-diagnostic guidance for a band.
 *
 * Everything here is precautionary framing taken from the dictionary — nothing
 * is inferred from a reading, nothing is addressed to an individual, and no
 * symptom is attributed to air quality. The sensitive groups are always named
 * in full rather than narrowed to the leading pollutant: excluding a group
 * risks telling someone the advice is not for them, and the cost of naming one
 * group too many is nil.
 *
 * A `null` category produces the "we cannot advise" state. Silence would be
 * read as an all-clear.
 */
export function HealthGuidance({
  category,
  headingLevel = 'h3',
  detail,
  showLead = true,
  dict = getDictionary(),
  className,
  ...props
}: HealthGuidanceProps) {
  const resolved = category ?? null;
  const Heading = headingLevel;
  const SubHeading = SUB_HEADING[headingLevel];

  const resolvedDetail = detail ?? (resolved && isElevatedCategory(resolved) ? 'full' : 'brief');

  const lead = resolved ? t(dict, categoryShortAdviceKey(resolved)) : t(dict, 'health.noAdvice');

  const groups: readonly SensitiveGroup[] = SENSITIVE_GROUPS;

  return (
    <section
      data-slot="health-guidance"
      data-aq-category={resolved ?? 'none'}
      className={cn('flex flex-col gap-4', className)}
      {...props}
    >
      <Heading className="text-base font-semibold">{t(dict, 'health.sectionTitle')}</Heading>

      {showLead ? <p className="text-sm leading-relaxed">{lead}</p> : null}

      <div className="flex flex-col gap-1">
        <SubHeading className="text-sm font-semibold">{t(dict, 'health.forEveryone')}</SubHeading>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t(dict, categoryHealthKey(resolved, 'general'))}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <SubHeading className="text-sm font-semibold">
          {t(dict, 'health.forSensitiveGroups')}
        </SubHeading>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t(dict, categoryHealthKey(resolved, 'sensitive'))}
        </p>

        {resolvedDetail === 'full' ? (
          <dl className="border-border mt-1 flex flex-col gap-3 border-l-2 pl-4">
            {groups.map((group) => (
              <div key={group} className="flex flex-col gap-0.5">
                <dt className="text-sm font-medium">{t(dict, sensitiveGroupLabelKey(group))}</dt>
                <dd className="text-muted-foreground text-sm leading-relaxed">
                  {t(dict, sensitiveGroupAdviceKey(group))}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <ul className="text-muted-foreground flex flex-wrap gap-x-2 gap-y-1 text-sm">
            {groups.map((group) => (
              <li key={group} className="bg-muted text-foreground rounded-full px-2.5 py-1 text-xs">
                {t(dict, sensitiveGroupLabelKey(group))}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-border flex flex-col gap-2 border-t pt-3">
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t(dict, 'health.generalGuidance')}
        </p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t(dict, 'health.emergencyNote')}
        </p>
        <MedicalDisclaimer dict={dict} />
      </div>
    </section>
  );
}
