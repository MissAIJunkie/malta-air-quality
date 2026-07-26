import type { MetadataRoute } from 'next';

import { ALL_NAV } from '@/components/layout/nav-items';
import { STATIONS } from '@/config/stations';
import { absoluteUrl } from '@/lib/analytics';

/**
 * Sitemap.
 *
 * Generated from the same navigation list the header and footer render, so a
 * route cannot be added to the menu and forgotten here.
 *
 * `lastModified` is the build time. That is honest for these pages: the content
 * changes when the site is deployed, not when a reading arrives. Stamping the
 * current time on every request would tell crawlers the About page changes
 * hourly, which is untrue and eventually gets the whole sitemap discounted.
 */
const BUILT_AT = new Date();

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = ALL_NAV.filter((item) => item.sitemap).map((item) => ({
    url: absoluteUrl(item.href),
    lastModified: BUILT_AT,
    changeFrequency: item.changeFrequency,
    priority: item.priority,
  }));

  /**
   * One entry per station.
   *
   * Only active stations: a discontinued site has no page, and listing one would
   * send crawlers to a 404. `hourly` because these pages carry the readings
   * themselves, unlike the prose pages above.
   */
  const stations: MetadataRoute.Sitemap = STATIONS.filter((station) => station.active).map(
    (station) => ({
      url: absoluteUrl(`/station/${station.slug}`),
      lastModified: BUILT_AT,
      changeFrequency: 'hourly',
      priority: 0.8,
    }),
  );

  return [...pages, ...stations];
}
