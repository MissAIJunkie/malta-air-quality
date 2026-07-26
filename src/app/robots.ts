import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/analytics';

/**
 * robots.txt
 *
 * Everything a person can read is open to crawlers. `/api/` is disallowed not
 * because it is secret — it is public and documented — but because a crawler
 * indexing JSON envelopes wastes both its budget and the upstream feed's
 * goodwill, and the same information is already on the pages.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
