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

const PAGE_TITLE = 'Contact';
const PAGE_DESCRIPTION =
  'How to reach the person who runs maqua.app — for corrections, data questions, licensing, or anything the site gets wrong.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/contact' },
  openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'website' },
};

/**
 * The published contact address.
 *
 * An alias on the site's own domain rather than a personal mailbox: a page that
 * carries advertising is a published work, and the address on it should belong
 * to the publication. Held as one constant so it is greppable.
 *
 * This must forward somewhere before the page ships. An address that bounces is
 * worse than no contact page at all.
 */
const CONTACT_EMAIL = 'hello@maqua.app';

const SOURCE_REPOSITORY = 'https://github.com/MissAIJunkie/malta-air-quality';
/**
 * ERA's own site.
 *
 * The root, deliberately — not a guessed `/contact-us` path. ERA blocks
 * automated requests site-wide (every path returns 403 to a non-browser client,
 * which is also why `docs/CONTEXT_SOURCES.md` records its licensing as "not
 * established"), so a deep link cannot be verified from here and a 404 on a
 * monetised site's contact page is exactly the unfinished-site signal this work
 * set out to remove. `docs/CONTEXT_SOURCES.md` names this origin.
 */
const ERA_SITE = 'https://era.org.mt/';

export default function ContactPage() {
  const dict = getDictionary();

  return (
    <ContentPage title={PAGE_TITLE} lead={t(dict, 'contact.lead')}>
      <ContentSection id="email" heading="By email">
        <Paragraph>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-primary font-medium underline underline-offset-4"
          >
            {CONTACT_EMAIL}
          </a>{' '}
          reaches the one person who builds and runs this site. There is no team and no support
          queue, so a reply may take a few days — but every message is read by a human, and
          corrections are acted on.
        </Paragraph>
        <Paragraph>
          It helps enormously if you include the page you were looking at, the station, and the hour
          shown on the reading. Air-quality figures are revised after publication, so &ldquo;the
          number looked wrong&rdquo; is hard to investigate a week later without those three things.
        </Paragraph>
      </ContentSection>

      <ContentSection id="useful" heading="What is genuinely useful to report">
        <Paragraph>
          This site tries hard not to overstate what five monitoring stations can tell you. The most
          valuable messages are the ones that catch it doing so anyway.
        </Paragraph>
        <BulletList>
          <li>
            <strong className="text-foreground font-medium">A band that looks wrong.</strong> The
            arithmetic is published on the{' '}
            <Link href="/methodology" className="text-primary underline underline-offset-4">
              {t(dict, 'nav.methodology')}
            </Link>{' '}
            page and the thresholds are in the source code, so a disagreement can usually be settled
            by checking rather than by opinion.
          </li>
          <li>
            <strong className="text-foreground font-medium">
              Maltese place names and orthography.
            </strong>{' '}
            Għarb and Żejtun are rendered with their proper diacritics throughout, and the fonts are
            subset to keep them from breaking mid-word. If anything still reads wrongly to a Maltese
            speaker, that is a defect.
          </li>
          <li>
            <strong className="text-foreground font-medium">Station siting.</strong> The station
            descriptions are built from the classifications ERA publishes. If a description
            misrepresents what is actually around a monitor, say so.
          </li>
          <li>
            <strong className="text-foreground font-medium">Accessibility.</strong> Every band is
            meant to be legible without relying on colour, and the whole site is meant to work from
            the keyboard and with a screen reader. Anywhere that fails is a bug, not a limitation.
          </li>
          <li>
            <strong className="text-foreground font-medium">Anything that overclaims.</strong> A
            forecast described as a measurement, a stale reading described as live, or a single hour
            presented as a breach of a legal limit. These are the failures this project cares most
            about.
          </li>
        </BulletList>
      </ContentSection>

      <ContentSection id="not-us" heading="What this address cannot help with">
        <Paragraph>
          maqua.app is an independent project. It renders published measurements; it does not
          produce them, and it has no standing to act on them.
        </Paragraph>
        <DefinitionList>
          <Definition term="Official statements, compliance and complaints">
            The Environment and Resources Authority operates the monitoring network and is the
            authority on Maltese air quality. For anything official — a compliance question, an
            incident, a formal complaint, a data request with legal weight — approach{' '}
            <a
              href={ERA_SITE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              ERA directly
              <span className="sr-only"> ({t(dict, 'a11y.newWindow')})</span>
            </a>{' '}
            — its site carries its own contact routes. Its publications take precedence over
            anything here.
          </Definition>
          <Definition term="Medical questions">
            The band-by-band guidance is the conventional wording attached to each index level, and
            the pollutant guides add general precautions of the kind public-health bodies publish —
            moving strenuous exercise off a hot bright afternoon, keeping a reliever inhaler to hand
            during an episode. All of it is general information about the air and about populations.
            None of it is advice about you, your condition or your medication, and none of it is
            written by a clinician.
          </Definition>
          <Definition term="Emergencies">{t(dict, 'disclaimer.emergency')}</Definition>
        </DefinitionList>
        <Callout tone="warning">{t(dict, 'disclaimer.medical')}</Callout>
      </ContentSection>

      <ContentSection id="technical" heading="Bugs, data and reuse">
        <Paragraph>
          The site is open source, and a bug report with a reproduction is more useful in public
          than in a mailbox — it stays findable for the next person who hits the same thing.
        </Paragraph>
        <BulletList>
          <li>
            <a
              href={`${SOURCE_REPOSITORY}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              Open an issue on the source repository
              <span className="sr-only"> ({t(dict, 'a11y.newWindow')})</span>
            </a>{' '}
            — for defects, feature requests and questions about the implementation.
          </li>
          <li>
            For reuse of what this site publishes, and the attribution the upstream data requires,
            see the{' '}
            <Link href="/terms" className="text-primary underline underline-offset-4">
              {t(dict, 'nav.terms')}
            </Link>
            .
          </li>
          <li>
            The{' '}
            <Link href="/privacy" className="text-primary underline underline-offset-4">
              {t(dict, 'nav.privacy')}
            </Link>{' '}
            page covers what the site itself collects. It does not describe email sent to the
            address above, because that is an ordinary mailbox rather than something this site
            processes: a message stays in it until it is dealt with, and it is used to reply to you
            and for nothing else.
          </li>
        </BulletList>
      </ContentSection>

      <ContentSection id="attribution" heading="Who runs this">
        <Paragraph>{t(dict, 'about.whoBody')}</Paragraph>
        <Callout>{t(dict, 'footer.attribution')}</Callout>
      </ContentSection>
    </ContentPage>
  );
}
