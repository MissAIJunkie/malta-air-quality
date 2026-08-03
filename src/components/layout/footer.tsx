import Link from 'next/link';

import { MaquaMark, Wordmark } from '@/components/layout/brand';
import { INFORMATION_NAV, PRIMARY_NAV } from '@/components/layout/nav-items';
import { getDictionary, hasKey, t } from '@/lib/i18n';

const EEA_INDEX_URL = 'https://airindex.eea.europa.eu/AQI/index.html';
const ERA_URL = 'https://era.org.mt/topic/real-time-air-quality-network/';

function copy(key: string, fallback: string): string {
  const dict = getDictionary();
  return hasKey(dict, key) ? t(dict, key) : fallback;
}

/**
 * Site footer.
 *
 * Carries the attribution required by the upstream terms of use, verbatim from
 * the dictionary. `footer.attribution` is fixed text: it names ERA as the data
 * owner, the EEA as the dissemination channel, and states that maqua.app is
 * independent of both. It is never paraphrased, abbreviated or split across
 * elements, so read it from the dictionary rather than retyping it.
 *
 * The medical disclaimer sits here too, so it is present on every page rather
 * than only where advice happens to be rendered.
 */
export function SiteFooter() {
  const dict = getDictionary();
  const year = new Date().getUTCFullYear();

  return (
    <footer
      className="border-border bg-surface-sunken mt-auto border-t pb-[env(safe-area-inset-bottom)]"
      data-print-hidden
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
        {/* Mast: the wordmark and what the site is, in one quiet band. The link
            strips below run as labelled inline rows — a colophon, not a sitemap
            of columns. */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <MaquaMark className="size-8" />
            <Wordmark className="text-lg" />
          </div>
          <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
            {t(dict, 'app.description')}
          </p>
          <p className="text-muted-foreground text-sm">{t(dict, 'footer.independent')}</p>
        </div>

        <div className="flex flex-col gap-2">
          <nav
            aria-label={copy('footer.navLabel', 'Footer navigation')}
            className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6"
          >
            <h2 className="text-muted-foreground font-mono text-[0.6875rem] font-medium tracking-[0.14em] uppercase sm:w-28 sm:shrink-0">
              {copy('footer.exploreHeading', 'Explore')}
            </h2>
            <ul className="flex flex-wrap items-center gap-x-5">
              {[...PRIMARY_NAV, ...INFORMATION_NAV].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-sm whitespace-nowrap transition-colors"
                  >
                    {t(dict, item.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6">
            <h2 className="text-muted-foreground font-mono text-[0.6875rem] font-medium tracking-[0.14em] uppercase sm:w-28 sm:shrink-0">
              {t(dict, 'footer.dataSourceHeading')}
            </h2>
            <ul className="flex flex-wrap items-center gap-x-5">
              <li>
                <a
                  href={ERA_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-sm whitespace-nowrap transition-colors"
                >
                  {copy('footer.eraLink', 'Environment and Resources Authority')}
                  <span className="sr-only"> ({t(dict, 'a11y.newWindow')})</span>
                </a>
              </li>
              <li>
                <a
                  href={EEA_INDEX_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-sm whitespace-nowrap transition-colors"
                >
                  {copy('footer.eeaLink', 'European Air Quality Index')}
                  <span className="sr-only"> ({t(dict, 'a11y.newWindow')})</span>
                </a>
              </li>
              <li>
                <Link
                  href="/methodology"
                  className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-sm whitespace-nowrap transition-colors"
                >
                  {t(dict, 'footer.methodologyLink')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-border flex flex-col gap-3 border-t pt-6">
          {/* VERBATIM — required by the upstream terms of use. */}
          <p className="text-muted-foreground max-w-4xl text-xs leading-relaxed">
            {t(dict, 'footer.attribution')}
          </p>
          <p className="text-muted-foreground max-w-4xl text-xs leading-relaxed">
            {t(dict, 'disclaimer.medical')}
          </p>
          <p className="text-muted-foreground text-xs">
            {t(dict, 'footer.copyright', { year })}
            <span aria-hidden="true">{t(dict, 'common.separator')}</span>
            <span className="sr-only"> </span>
            {t(dict, 'time.timezoneNote')}
          </p>
        </div>
      </div>
    </footer>
  );
}
