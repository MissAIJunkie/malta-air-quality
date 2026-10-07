import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EnrichedContextEvent } from '@/lib/environmental-context/types';

import { EventCard } from '../event-card';

/**
 * A representative Saharan-dust forecast card — the exact shape that used to be
 * the only `<article>` on the page.
 */
const EVENT: EnrichedContextEvent = {
  id: 'dust-2026-10-07',
  type: 'saharan_dust',
  title: 'Saharan dust expected over Malta',
  summary:
    'A Copernicus forecast indicates elevated dust over the islands. These are modelled values, not measurements.',
  impactDirection: 'worsening',
  confidence: 'medium',
  observedOrForecast: 'forecast',
  startsAt: '2026-10-07T06:00:00Z',
  endsAt: '2026-10-08T06:00:00Z',
  publishedAt: '2026-10-07T00:00:00Z',
  fetchedAt: '2026-10-07T07:00:00Z',
  sourceName: 'Copernicus Atmosphere Monitoring Service',
  sourceUrl: 'https://atmosphere.copernicus.eu/',
  affectedPollutants: ['PM10'],
  aiGeneratedSummary: false,
  citations: [],
  relevance: 0.9,
};

describe('EventCard — main-content extraction', () => {
  /**
   * This is the guard for the defect fixed on 2026-10-07.
   *
   * These cards were `<article>` elements, and the only ones on any page.
   * `<article>` is the strongest main-content signal in the readability family
   * of heuristics that boilerplate strippers descend from, so recall-favouring
   * extraction of `/` and `/station/<id>` collapsed to 444 characters — the
   * dust card alone, with no `h1`, no band, no measured value and no timestamp.
   *
   * The card is not independently distributable: the "these are modelled
   * values, not measurements" qualifier lives in the parent widget, outside the
   * card. So `<article>` was also simply untrue.
   *
   * If this test fails, every citation of this site is about to describe a
   * Copernicus forecast instead of a measured reading.
   */
  it('is not an <article>, so it cannot pose as the page’s main content', () => {
    const { container } = render(<EventCard event={EVENT} />);

    expect(container.querySelector('article')).toBeNull();
  });

  it('still renders the card content it is responsible for', () => {
    const { container } = render(<EventCard event={EVENT} />);

    // The fix must be a tag change and nothing more: same heading, same text.
    expect(container.querySelector('h3')).not.toBeNull();
    expect(container.textContent).toContain('Saharan dust');
  });
});
