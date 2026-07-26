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
  SubHeading,
} from '@/components/layout/content-page';
import { getCapabilities, type Capabilities } from '@/config/env';
import { analyticsEnabled, speedInsightsEnabled } from '@/lib/analytics';
import { getDictionary, hasKey, t } from '@/lib/i18n';

/**
 * Which optional subsystems this deployment has, or `null` if that cannot be
 * determined.
 *
 * `getCapabilities()` parses the whole environment and throws on any malformed
 * variable — an empty `NEXT_PUBLIC_APP_URL`, say. Failing loudly is right at
 * boot, but it must not take down the privacy notice: a page that 500s tells a
 * reader nothing about how their data is handled, which is the one thing this
 * page exists to do.
 */
function readCapabilities(): Capabilities | null {
  try {
    return getCapabilities();
  } catch {
    return null;
  }
}

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What maqua.app does and does not collect: analytics, geolocation, email alerts, AI processing, ' +
    'map tiles, retention and how to have your data removed.',
  alternates: { canonical: '/privacy' },
};

/**
 * /privacy
 *
 * Written against what this deployment can actually do. `getCapabilities()`
 * reports which optional subsystems are configured, so a build with no database
 * and no email says plainly that it stores nothing, rather than reciting a
 * generic policy about services it does not run.
 *
 * The analytics flags are read from the same module the root layout uses to
 * decide whether to load the scripts at all, so this page cannot claim
 * measurement is off while the script is being served.
 */
export default function PrivacyPage() {
  const dict = getDictionary();
  const s = (key: string, fallback: string): string =>
    hasKey(dict, key) ? t(dict, key) : fallback;

  const capabilities = readCapabilities();
  const anyAnalytics = analyticsEnabled || speedInsightsEnabled;

  /**
   * How a service's status is described.
   *
   * When the configuration cannot be read the answer is "unknown", never "not
   * configured". Claiming a service is switched off is a privacy assertion, and
   * this page must not make one it cannot support — the safe-looking answer is
   * the dishonest one here.
   */
  const state = (flag: boolean | undefined): string =>
    capabilities === null ? 'status unknown' : flag ? 'configured' : 'not configured';

  const off = (flag: boolean | undefined): boolean => capabilities !== null && flag === false;

  return (
    <ContentPage
      title={s('privacy.title', 'Privacy')}
      lead={s(
        'privacy.lead',
        'maqua.app is a public-information site. It has no accounts, no advertising and no tracking profiles. This page describes the small amount of data that does move, and who handles it.',
      )}
      aside={
        <p className="text-subtle text-sm">
          {s('privacy.scope', 'Applies to maqua.app and its API.')}
        </p>
      }
    >
      <ContentSection id="summary" heading={s('privacy.summaryHeading', 'In short')}>
        <BulletList>
          <li>No account is needed, and none can be created.</li>
          <li>
            No advertising, no ad networks, no cross-site tracking, no data sold or shared for
            marketing.
          </li>
          <li>
            The only personal data the site can ever store is an email address, and only if you ask
            for alerts and then confirm.
          </li>
          <li>
            Your location, if you choose to share it, stays in your browser. It is never transmitted
            to this site and never stored.
          </li>
          <li>No cookies are set for analytics or advertising.</li>
        </BulletList>
        <Callout>
          {anyAnalytics
            ? 'This deployment has anonymous, cookieless usage measurement enabled. Details below.'
            : 'This deployment has usage measurement switched off entirely. No analytics script is served.'}
        </Callout>
      </ContentSection>

      <ContentSection id="analytics" heading={s('privacy.analyticsHeading', 'Usage measurement')}>
        <Paragraph>
          {anyAnalytics
            ? 'Vercel Analytics and Vercel Speed Insights are used to understand which pages are read and how quickly they load. Both are cookieless: they set nothing on your device and build no cross-site profile. What is recorded is the page path, an approximate country, referrer, device type and page-performance timings, aggregated so an individual visitor cannot be picked out or followed between visits.'
            : 'Nothing measures your use of this site. No analytics script is loaded and no page-view events are sent anywhere.'}
        </Paragraph>
        {anyAnalytics ? (
          <BulletList>
            <li>
              Page views:{' '}
              <strong className="text-foreground font-medium">
                {analyticsEnabled ? 'enabled' : 'disabled'}
              </strong>
            </li>
            <li>
              Performance timings:{' '}
              <strong className="text-foreground font-medium">
                {speedInsightsEnabled ? 'enabled' : 'disabled'}
              </strong>
            </li>
          </BulletList>
        ) : null}
        <Paragraph>
          Independently of this, the hosting platform keeps ordinary server request logs — the kind
          every web server keeps — for a short period, for security and abuse prevention. These
          contain an IP address, which is personal data. They are not used to profile visitors and
          are not combined with anything else on this site.
        </Paragraph>
      </ContentSection>

      <ContentSection
        id="cookies"
        heading={s('privacy.cookiesHeading', 'Cookies and local storage')}
      >
        <Paragraph>
          maqua.app sets no cookies for analytics, advertising or tracking. There is therefore no
          consent banner, because there is nothing to consent to.
        </Paragraph>
        <DefinitionList>
          <Definition term={s('privacy.themeStorage', 'Appearance preference')}>
            Choosing light, dark or &ldquo;match device&rdquo; stores a single value in your
            browser&apos;s local storage so the page does not flash the wrong theme on your next
            visit. It never leaves your device and can be cleared with your browser data.
          </Definition>
          <Definition term={s('privacy.sessionData', 'In-page data')}>
            Readings fetched while you browse are held in memory for the life of the tab and are
            discarded when it closes.
          </Definition>
        </DefinitionList>
      </ContentSection>

      <ContentSection id="location" heading={s('privacy.locationHeading', 'Location')}>
        <Paragraph>
          The map has an optional &ldquo;find my location&rdquo; control. It uses your
          browser&apos;s geolocation, which always asks your permission first and can be declined
          without losing any other feature.
        </Paragraph>
        <Callout tone="warning">
          {s(
            'privacy.locationPromise',
            'Your coordinates are used only inside your browser, to centre the map and to work out which monitoring station is nearest. They are never sent to this site, never written to a database, and never included in a log.',
          )}
        </Callout>
        <Paragraph>
          Declining the prompt changes nothing else: every station is reachable from the map and
          from the list either way. Permission can be revoked at any time in your browser settings.
        </Paragraph>
      </ContentSection>

      <ContentSection id="alerts" heading={s('privacy.alertsHeading', 'Email alerts')}>
        <Paragraph>
          {capabilities === null
            ? 'This deployment\u2019s configuration could not be read, so whether alerts are enabled here cannot be stated. What follows describes what alerts do when they ARE enabled.'
            : capabilities.email && capabilities.database
              ? 'Alerts are available on this deployment. They are strictly opt-in and use double opt-in: an address is only ever activated after you follow a confirmation link sent to it.'
              : 'Alerts are not enabled on this deployment. No email address can be submitted, and none is stored.'}
        </Paragraph>
        <SubHeading>
          {s('privacy.alertsDataHeading', 'What is stored, if you subscribe')}
        </SubHeading>
        <BulletList>
          <li>Your email address.</li>
          <li>The station and band you asked to be alerted about, and how often.</li>
          <li>
            Whether the address has been confirmed, and the times of subscription, confirmation and
            the most recent alert — needed to avoid sending the same alert twice.
          </li>
        </BulletList>
        <Paragraph>
          The address is used for nothing but the alerts you asked for. There is no newsletter, no
          marketing, and it is never shared with or sold to anyone.
        </Paragraph>
        <Paragraph>
          The legal basis is your consent, and consent can be withdrawn at any time. Every alert
          email carries a one-click unsubscribe link. Confirmation and unsubscribe links are signed
          so that nobody can subscribe or unsubscribe an address they do not control.
        </Paragraph>
      </ContentSection>

      <ContentSection id="processors" heading={s('privacy.processorsHeading', 'Services involved')}>
        <Paragraph>
          maqua.app is deliberately thin, but a few third parties are involved in delivering it.
          Each is listed with what it actually sees. Where a service is not configured on this
          deployment, it processes nothing at all.
        </Paragraph>
        {capabilities === null ? (
          <Callout tone="warning">
            {s(
              'privacy.capabilitiesUnknown',
              'This deployment\u2019s configuration could not be read, so the per-service statuses below are shown as unknown rather than guessed. Each entry describes what that service does when it is in use.',
            )}
          </Callout>
        ) : null}
        <DefinitionList>
          <Definition term="Vercel — hosting">
            Serves every page and API response, and therefore sees your IP address and request
            headers as any web host would. Also provides the optional analytics described above.
          </Definition>
          <Definition term="Base map tiles — third-party tile service">
            The map is drawn from tiles your browser requests directly from a tile provider, using
            OpenStreetMap data. Those requests reveal your IP address and which part of the map you
            are looking at to that provider, and they are subject to its own privacy policy rather
            than this one. Choosing the list view instead of the map avoids them entirely.
          </Definition>
          <Definition term={`Neon — PostgreSQL database (${state(capabilities?.database)})`}>
            {off(capabilities?.database)
              ? 'Not configured on this deployment. Nothing is written to a database, so no subscription or history exists to store.'
              : 'Stores alert subscriptions and historical readings. Hosted in the European Union.'}
          </Definition>
          <Definition term={`Resend — email delivery (${state(capabilities?.email)})`}>
            {off(capabilities?.email)
              ? 'Not configured on this deployment. No email is sent and no address is transmitted.'
              : 'Delivers confirmation and alert emails, and therefore processes your address and the content of those messages.'}
          </Definition>
          <Definition term={`Upstash — Redis cache (${state(capabilities?.redis)})`}>
            {off(capabilities?.redis)
              ? 'Not configured on this deployment. Caching falls back to the memory of the running server instance and nothing is written to an external store.'
              : 'Caches air-quality responses and enforces rate limits. It holds public readings and short-lived request counters. Rate limiting is keyed on a hashed, truncated identifier rather than a stored IP address.'}
          </Definition>
          <Definition term={`OpenRouter — AI explanations (${state(capabilities?.ai)})`}>
            {off(capabilities?.ai)
              ? 'Not configured on this deployment. No request is made to any AI provider, and explanations are assembled from the measured data without one.'
              : 'Routes requests for plain-language explanations to a language model. What is sent is the air-quality figures already shown on the page — station, pollutant, concentration, band and time. Nothing that identifies you is included: no IP address, no email address, no location, no request history. Explanations are cached so that the same reading is not sent repeatedly.'}
          </Definition>
          <Definition term="Environment and Resources Authority and the European Environment Agency">
            The source of the measurements. Requests to the upstream feed are made by our server, on
            a schedule, and never by your browser — so your visit is not visible to either
            organisation.
          </Definition>
        </DefinitionList>
      </ContentSection>

      <ContentSection
        id="retention"
        heading={s('privacy.retentionHeading', 'How long things are kept')}
      >
        <DefinitionList>
          <Definition term={s('privacy.retentionSubscriptions', 'Alert subscriptions')}>
            Kept while the subscription is active. Removed when you unsubscribe. An unconfirmed
            subscription expires by itself if the confirmation link is never followed, and the
            pending record is deleted.
          </Definition>
          <Definition term={s('privacy.retentionReadings', 'Air-quality readings')}>
            Public environmental measurements, not personal data. Retained to show history and
            trends.
          </Definition>
          <Definition term={s('privacy.retentionLogs', 'Server and error logs')}>
            Short-lived, kept for operational and security purposes only.
          </Definition>
          <Definition term={s('privacy.retentionCache', 'Caches')}>
            Expire on their own, typically within minutes to an hour.
          </Definition>
        </DefinitionList>
      </ContentSection>

      <ContentSection
        id="rights"
        heading={s('privacy.rightsHeading', 'Your rights, and how to use them')}
      >
        <Paragraph>
          Under the GDPR you can ask for access to your personal data, its correction or erasure, a
          restriction on its processing, a copy in a portable form, and you can object to
          processing. You can also complain to Malta&apos;s Information and Data Protection
          Commissioner.
        </Paragraph>
        <Paragraph>
          In practice, the only personal data this site can hold is an email address you gave it for
          alerts, so most requests reduce to one action:
        </Paragraph>
        <BulletList>
          <li>
            <strong className="text-foreground font-medium">Stop and delete:</strong> use the
            unsubscribe link in any alert email, or the{' '}
            <Link href="/alerts" className="text-primary underline underline-offset-4">
              {t(dict, 'nav.alerts')}
            </Link>{' '}
            page. Unsubscribing removes the subscription record, including the address.
          </li>
          <li>
            <strong className="text-foreground font-medium">Anything else:</strong> raise an issue
            on the project&apos;s source repository, linked from the{' '}
            <Link href="/about" className="text-primary underline underline-offset-4">
              {t(dict, 'nav.about')}
            </Link>{' '}
            page. Please do not include personal details in a public issue.
          </li>
        </BulletList>
        <Paragraph>
          If you never subscribed to alerts, this site holds nothing about you to access or erase.
        </Paragraph>
      </ContentSection>

      <ContentSection id="children" heading={s('privacy.childrenHeading', 'Children')}>
        <Paragraph>
          The site is general public information and is safe for anyone to read. Alerts require an
          email address, and are not intended for children under the age at which they can give
          valid consent.
        </Paragraph>
      </ContentSection>

      <ContentSection id="changes" heading={s('privacy.changesHeading', 'Changes to this page')}>
        <Paragraph>
          This page describes how the software actually behaves, and the parts of it that describe
          optional services are generated from the running configuration. If the way data is handled
          changes, this page changes in the same release.
        </Paragraph>
        <Paragraph>{t(dict, 'footer.attribution')}</Paragraph>
      </ContentSection>
    </ContentPage>
  );
}
