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
  /**
   * Shown in the desktop header strip.
   *
   * The header is a single row that has to survive a 320 px screen alongside
   * the live status and two controls, so it carries the pages a reader comes
   * here to use. The colophon pages — privacy, terms, contact — are reached
   * from the footer, which is where people look for them anyway. The mobile
   * menu and the sitemap carry everything regardless.
   */
  inHeader: boolean;
  /**
   * Capabilities this route needs before it can do what its label promises.
   *
   * Declared here rather than special-cased at each call site. `/alerts` offers
   * to email you; on a deployment without `RESEND_API_KEY` and a database it
   * can only explain that it cannot, which is not something to put in a menu.
   *
   * Omitted means "always available" — the page needs nothing beyond the
   * upstream feed.
   */
  requires?: ReadonlyArray<CapabilityName>;
};

/** A key of `getCapabilities()`. Narrowed to the ones a route may depend on. */
type CapabilityName = 'email' | 'database';

export const PRIMARY_NAV: NavItem[] = [
  {
    href: '/',
    labelKey: 'nav.home',
    descriptionKey: 'app.description',
    sitemap: true,
    changeFrequency: 'hourly',
    priority: 1,
    inHeader: true,
  },
  {
    href: '/alerts',
    labelKey: 'nav.alerts',
    descriptionKey: 'alerts.description',
    sitemap: true,
    changeFrequency: 'monthly',
    priority: 0.6,
    inHeader: true,
    requires: ['email', 'database'],
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
    inHeader: true,
  },
  {
    href: '/methodology',
    labelKey: 'nav.methodology',
    descriptionKey: 'methodology.indexBody',
    sitemap: true,
    changeFrequency: 'monthly',
    priority: 0.7,
    inHeader: true,
  },
  {
    href: '/contact',
    labelKey: 'nav.contact',
    descriptionKey: 'contact.lead',
    sitemap: true,
    changeFrequency: 'yearly',
    priority: 0.4,
    inHeader: false,
  },
  {
    href: '/privacy',
    labelKey: 'nav.privacy',
    descriptionKey: 'alerts.privacyNote',
    sitemap: true,
    changeFrequency: 'yearly',
    priority: 0.3,
    inHeader: false,
  },
  {
    href: '/terms',
    labelKey: 'nav.terms',
    descriptionKey: 'terms.lead',
    sitemap: true,
    changeFrequency: 'yearly',
    priority: 0.3,
    inHeader: false,
  },
];

export const ALL_NAV: NavItem[] = [...PRIMARY_NAV, ...INFORMATION_NAV];

/**
 * The subset of `items` this deployment can honour.
 *
 * One predicate, used by the header, the footer and the sitemap, so a route
 * cannot be hidden from the menu but left in the sitemap — or the reverse.
 * Before this existed the sitemap tested `item.href !== '/alerts'` directly,
 * which put the same knowledge in two files and in neither of the two menus:
 * the header and footer went on linking a feature the deployment could not
 * provide, which is a visibly unfinished site.
 *
 * Note the asymmetry in evaluation time that remains: the sitemap is generated
 * at build time, the menus render per request. A credential added without a
 * redeploy brings the menus back before the sitemap catches up.
 */
export function availableNav(
  items: readonly NavItem[],
  capabilities: Record<CapabilityName, boolean>,
): NavItem[] {
  return items.filter((item) => (item.requires ?? []).every((name) => capabilities[name]));
}
