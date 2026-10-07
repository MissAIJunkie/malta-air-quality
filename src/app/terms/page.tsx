import type { Metadata } from 'next';
import Link from 'next/link';

import {
  BulletList,
  Callout,
  ContentPage,
  ContentSection,
  Definition,
  DefinitionList,
  Paragraph,
} from '@/components/layout/content-page';
import { getDictionary, t } from '@/lib/i18n';

const PAGE_TITLE = 'Terms';
const PAGE_DESCRIPTION =
  'The terms maqua.app is offered under: whose data it carries, what it does not promise, and what you may do with it.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/terms' },
  openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'website' },
};

const SOURCE_REPOSITORY = 'https://github.com/MissAIJunkie/malta-air-quality';
const SOURCE_LICENCE = 'https://github.com/MissAIJunkie/malta-air-quality/blob/main/LICENSE';
const EEA_REUSE = 'https://www.eea.europa.eu/en/legal-notice';
const OPEN_METEO = 'https://open-meteo.com/';
const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';

/**
 * /terms
 *
 * Deliberately narrow. This page states only what is already true and already
 * documented: who owns the upstream data and what its re-use policy requires,
 * what the site does not warrant, and the licence the code is published under.
 *
 * It does NOT state a governing law, a jurisdiction, a liability cap or a
 * dispute procedure. Those are legal positions for the site's owner to take
 * with advice, not defaults for a developer to invent — and a fabricated
 * jurisdiction clause is worse than an absent one.
 */
export default function TermsPage() {
  const dict = getDictionary();

  return (
    <ContentPage
      title={PAGE_TITLE}
      lead={t(dict, 'terms.lead')}
      aside={
        <p className="text-subtle text-sm">
          These terms describe how the site actually behaves. Where they and the{' '}
          <Link href="/methodology" className="text-primary underline underline-offset-4">
            methodology
          </Link>{' '}
          disagree, the methodology is the more precise account.
        </p>
      }
    >
      <ContentSection id="what" heading="What this site is">
        <Paragraph>
          maqua.app is a free, independent, public-information site. It presents air-quality
          measurements from the five automatic monitoring stations in Malta and Gozo, together with
          the European Air Quality Index band for each pollutant and the health wording
          conventionally attached to that band. There is no account, nothing to buy, and no service
          being sold to you.
        </Paragraph>
        <Paragraph>
          It is supported by advertising. What that means for your data is set out on the{' '}
          <Link href="/privacy" className="text-primary underline underline-offset-4">
            {t(dict, 'nav.privacy')}
          </Link>{' '}
          page. Advertising has no bearing on the readings, the bands or the guidance.
        </Paragraph>
        <Callout tone="warning">{t(dict, 'disclaimer.notOfficial')}</Callout>
      </ContentSection>

      <ContentSection id="data" heading="Whose data this is">
        <Paragraph>
          The measurements are not this site&apos;s to license. They are produced by Malta&apos;s
          Environment and Resources Authority and disseminated through the European Environment
          Agency, and they reach you here under the upstream re-use policies described below.
        </Paragraph>
        <DefinitionList>
          <Definition term="Air-quality measurements — ERA, via the EEA">
            Reported by Malta under Directive 2008/50/EC and Directive 2004/107/EC. EEA content is
            published under the agency&apos;s standard{' '}
            <a
              href={EEA_REUSE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              re-use policy
              <span className="sr-only"> ({t(dict, 'a11y.newWindow')})</span>
            </a>{' '}
            — re-use is permitted with acknowledgement of the source, unless otherwise stated.
          </Definition>
          <Definition term="Weather and dust context — Open-Meteo">
            Meteorological context and the CAMS-derived dust fields come from Open-Meteo under{' '}
            <a
              href={CC_BY_4}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              CC BY 4.0
              <span className="sr-only"> ({t(dict, 'a11y.newWindow')})</span>
            </a>
            , which requires attribution to{' '}
            <a
              href={OPEN_METEO}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              Open-Meteo
              <span className="sr-only"> ({t(dict, 'a11y.newWindow')})</span>
            </a>{' '}
            wherever the data appears. The underlying model output comes from national weather
            services and the Copernicus Atmosphere Monitoring Service under their own open terms.
          </Definition>
        </DefinitionList>
        <Callout>{t(dict, 'footer.attribution')}</Callout>
      </ContentSection>

      <ContentSection id="reuse" heading="Reusing what you find here">
        <Paragraph>
          You are welcome to. The readings are a public record, and this site exists to make them
          easier to read rather than to sit between you and them.
        </Paragraph>
        <BulletList>
          <li>
            <strong className="text-foreground font-medium">Carry the attribution forward.</strong>{' '}
            If you republish the measurements, acknowledge ERA and the EEA as above. If you
            republish the weather or dust context, acknowledge Open-Meteo. That obligation comes
            from the upstream licences, not from this site.
          </li>
          <li>
            <strong className="text-foreground font-medium">
              Use the API rather than scraping.
            </strong>{' '}
            <code className="text-foreground font-mono text-sm">/api/air-quality</code> returns the
            same readings the pages render, with the same provenance metadata — measured-at,
            retrieved-at, and whether a value is measured or modelled. It is public and documented.
            Please be considerate with it: it is a small project in front of someone else&apos;s
            feed.
          </li>
          <li>
            <strong className="text-foreground font-medium">Keep the provenance attached.</strong> A
            reading without its timestamp becomes a claim about now, and a modelled value without
            its label becomes a measurement. Both are the specific failures this project is built to
            avoid; please do not reintroduce them downstream.
          </li>
          <li>
            <strong className="text-foreground font-medium">The code is MIT-licensed.</strong> The
            calculation, the thresholds and the wording of every health message are in the{' '}
            <a
              href={SOURCE_REPOSITORY}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              source repository
              <span className="sr-only"> ({t(dict, 'a11y.newWindow')})</span>
            </a>{' '}
            under the{' '}
            <a
              href={SOURCE_LICENCE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              MIT licence
              <span className="sr-only"> ({t(dict, 'a11y.newWindow')})</span>
            </a>
            . The licence covers the code, not the measurements it renders.
          </li>
        </BulletList>
      </ContentSection>

      <ContentSection id="no-warranty" heading="What this site does not promise">
        <Paragraph>
          The site is provided as it is, without warranty. That is not boilerplate here — the
          specific limits are known, documented, and worth stating plainly.
        </Paragraph>
        <BulletList>
          <li>
            <strong className="text-foreground font-medium">The figures are provisional.</strong>{' '}
            {t(dict, 'disclaimer.provisional')}
          </li>
          <li>
            <strong className="text-foreground font-medium">Availability is not guaranteed.</strong>{' '}
            The site depends on an upstream feed it does not control. Instruments go offline for
            maintenance and calibration, hours go missing, and the feed itself can be unavailable.
            When a value is absent it is shown as absent — never as zero.
          </li>
          <li>
            <strong className="text-foreground font-medium">
              Five stations cannot describe every locality.
            </strong>{' '}
            A station reading applies to the air at that monitor. Your street may differ, and Għarb
            is the only station on Gozo.
          </li>
          <li>
            <strong className="text-foreground font-medium">
              Nothing here establishes legal compliance.
            </strong>{' '}
            Almost every EU limit value is an average over 24 hours or a calendar year, and several
            permit a set number of exceedances before the limit is breached. A single hourly reading
            above a threshold is not a breach, and this site will not describe one as such.
          </li>
          <li>
            <strong className="text-foreground font-medium">Forecasts are estimates.</strong>{' '}
            Modelled and gap-filled values are labelled as estimates wherever they appear, and are
            never presented as observations.
          </li>
        </BulletList>
        <Callout tone="warning">{t(dict, 'disclaimer.medical')}</Callout>
        <Paragraph>{t(dict, 'disclaimer.emergency')}</Paragraph>
      </ContentSection>

      <ContentSection id="changes" heading="Changes, and how to raise something">
        <Paragraph>
          These terms may change as the site does. Because the whole site is version-controlled in
          public, every change to this page has a dated commit behind it, which is a more useful
          record than a &ldquo;last updated&rdquo; line maintained by hand.
        </Paragraph>
        <Paragraph>
          If something here is wrong, unclear, or overstates what the data supports, please say so —{' '}
          <Link href="/contact" className="text-primary underline underline-offset-4">
            {t(dict, 'nav.contact')}
          </Link>
          .
        </Paragraph>
      </ContentSection>
    </ContentPage>
  );
}
