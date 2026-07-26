/**
 * Site navigation, in one place.
 *
 * The header, the mobile menu, the footer and the sitemap all read this list, so
 * a route cannot appear in the menu but be missing from the sitemap, or be
 * removed from one and left behind in another.
 *
 * `labelKey` resolves through the dictionary; nothing here is a literal string.
 */

export type NavItem = {
  href: string;
  labelKey: string;
  /** Short description, used in the mobile menu and on the not-found page. */
  descriptionKey: string;
  /** Included in the generated sitemap. */
  sitemap: boolean;
  changeFrequency: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: number;
};

export const PRIMARY_NAV: NavItem[] = [
  {
    href: '/',
    labelKey: 'nav.home',
    descriptionKey: 'app.description',
    sitemap: true,
    changeFrequency: 'hourly',
    priority: 1,
  },
  {
    href: '/alerts',
    labelKey: 'nav.alerts',
    descriptionKey: 'alerts.description',
    sitemap: true,
    changeFrequency: 'monthly',
    priority: 0.6,
  },
];

export const INFORMATION_NAV: NavItem[] = [
  {
    href: '/about',
    labelKey: 'nav.about',
    descriptionKey: 'about.whatBody',
    sitemap: true,
    changeFrequency: 'monthly',
    priority: 0.5,
  },
  {
    href: '/methodology',
    labelKey: 'nav.methodology',
    descriptionKey: 'methodology.indexBody',
    sitemap: true,
    changeFrequency: 'monthly',
    priority: 0.7,
  },
  {
    href: '/privacy',
    labelKey: 'nav.privacy',
    descriptionKey: 'alerts.privacyNote',
    sitemap: true,
    changeFrequency: 'yearly',
    priority: 0.3,
  },
];

export const ALL_NAV: NavItem[] = [...PRIMARY_NAV, ...INFORMATION_NAV];
