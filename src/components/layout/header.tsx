import Link from 'next/link';

import { MaquaMark, Wordmark } from '@/components/layout/brand';
import { HeaderStatus } from '@/components/layout/header-status';
import { MobileMenu, type MenuLink } from '@/components/layout/mobile-menu';
import { INFORMATION_NAV, PRIMARY_NAV } from '@/components/layout/nav-items';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { getDictionary, hasKey, t } from '@/lib/i18n';

/**
 * Resolve a key, falling back to supplied English if the dictionary lacks it.
 *
 * `t()` returns the key itself on a miss, which is right during development but
 * would show `nav.information` to a member of the public.
 */
function copy(key: string, fallback: string): string {
  const dict = getDictionary();
  return hasKey(dict, key) ? t(dict, key) : fallback;
}

/**
 * Site header.
 *
 * Server-rendered apart from two islands: the live Malta-wide status, and the
 * two interactive controls. It is sticky rather than fixed so it never covers
 * content at the bottom of a scrolled page, and it is translucent over the map
 * so the islands stay visible behind it on a phone.
 *
 * `pt-[env(safe-area-inset-top)]` keeps the row clear of a notch or a rounded
 * corner in standalone (installed) mode, where there is no browser chrome above
 * it.
 */
export function SiteHeader() {
  const dict = getDictionary();

  const toLinks = (items: typeof PRIMARY_NAV): MenuLink[] =>
    items.map((item) => ({
      href: item.href,
      label: t(dict, item.labelKey),
      description: t(dict, item.descriptionKey),
    }));

  const themeToggle = (
    <ThemeToggle
      labels={{
        group: t(dict, 'theme.label'),
        light: t(dict, 'theme.light'),
        dark: t(dict, 'theme.dark'),
        system: t(dict, 'theme.system'),
      }}
    />
  );

  return (
    <header
      className={[
        // A deeper blur over a more transparent ground than before: the bar
        // reads as an instrument panel floating over the map, not a solid slab.
        'border-border/70 bg-background/70 sticky top-0 z-40 border-b backdrop-blur-xl',
        'pt-[env(safe-area-inset-top)]',
      ].join(' ')}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-3 py-2 sm:gap-4 sm:px-6 sm:py-3">
        <Link
          href="/"
          className="rounded-card -m-1 flex min-h-11 shrink-0 items-center gap-2 p-1 sm:gap-2.5"
        >
          <MaquaMark className="size-8 sm:size-9" />
          <span className="flex flex-col leading-none">
            <Wordmark className="text-base sm:text-lg" />
            <span className="text-muted-foreground hidden text-[0.6875rem] sm:block">
              {t(dict, 'header.subtitle')}
            </span>
          </span>
        </Link>

        {/* Status sits between the wordmark and the controls so it is the first
            thing read after the site name. `min-w-0` lets it truncate rather
            than push the controls off a 320 px screen. */}
        <HeaderStatus className="min-w-0 flex-1" />

        <nav
          aria-label={t(dict, 'a11y.mainNavigation')}
          className="hidden items-center gap-1 md:flex"
        >
          {[...PRIMARY_NAV.filter((item) => item.href !== '/'), ...INFORMATION_NAV].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors"
            >
              {t(dict, item.labelKey)}
            </Link>
          ))}
        </nav>

        <div className="hidden md:block">{themeToggle}</div>

        <div className="md:hidden">
          <MobileMenu
            primary={toLinks(PRIMARY_NAV)}
            information={toLinks(INFORMATION_NAV)}
            appearance={
              <div className="flex flex-col gap-2">
                <span className="text-foreground text-sm font-medium">
                  {t(dict, 'theme.label')}
                </span>
                {themeToggle}
              </div>
            }
            labels={{
              trigger: t(dict, 'nav.menu'),
              title: copy('nav.menuTitle', 'maqua.app'),
              description: t(dict, 'app.tagline'),
              close: t(dict, 'nav.closeMenu'),
              informationHeading: copy('nav.informationHeading', 'Information'),
              currentPage: t(dict, 'a11y.currentPage'),
            }}
          />
        </div>
      </div>
    </header>
  );
}
