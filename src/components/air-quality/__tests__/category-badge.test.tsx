import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AIR_QUALITY_CATEGORIES, CATEGORY_PRESENTATION } from '@/config/thresholds';

import { CategoryBadge } from '../category-badge';
import { FreshnessIndicator } from '../freshness-indicator';

describe('CategoryBadge', () => {
  it('writes the band out in words for every category', () => {
    for (const category of AIR_QUALITY_CATEGORIES) {
      const { unmount } = render(<CategoryBadge category={category} />);
      expect(screen.getByText(category)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders a null category as "No data" rather than defaulting to Good', () => {
    render(<CategoryBadge category={null} />);
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByText('Good')).not.toBeInTheDocument();
  });

  it('carries the band id, the icon and the written label, so colour is never alone', () => {
    const { container } = render(<CategoryBadge category="Poor" />);
    const badge = container.querySelector('[data-slot="category-badge"]');

    expect(badge).toHaveAttribute('data-aq-band', String(CATEGORY_PRESENTATION.Poor.bandId));
    // Icon and written label are the colour-independent cues on a badge.
    expect(badge?.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('Poor')).toBeInTheDocument();
  });

  it('does not apply a texture, which belongs to the label-less map marker', () => {
    const { container } = render(<CategoryBadge category="Poor" />);
    const badge = container.querySelector('[data-slot="category-badge"]');

    // A marker has only colour, icon and texture. A badge spells the band out in
    // words, so the texture carries no extra information and tiles as noise.
    expect(badge?.className).not.toMatch(/aq-pattern-/);
  });

  it('uses band 0 for no data, which is not a category', () => {
    const { container } = render(<CategoryBadge category={null} />);
    expect(container.querySelector('[data-slot="category-badge"]')).toHaveAttribute(
      'data-aq-band',
      '0',
    );
  });

  it('shows the sub-index when one is supplied', () => {
    render(<CategoryBadge category="Moderate" subIndex={3.42} />);
    expect(screen.getByText('3.4')).toBeInTheDocument();
  });
});

describe('FreshnessIndicator', () => {
  it('says "Live" only when the reading really is fresh', () => {
    const { unmount } = render(
      <FreshnessIndicator
        freshness="fresh"
        measuredAt="2026-07-26T06:00:00Z"
        nowIso="2026-07-26T07:05:00Z"
      />,
    );
    expect(screen.getByText('Live')).toBeInTheDocument();
    unmount();

    for (const state of ['delayed', 'stale', 'unavailable'] as const) {
      const view = render(
        <FreshnessIndicator
          freshness={state}
          measuredAt="2026-07-26T06:00:00Z"
          nowIso="2026-07-26T18:00:00Z"
        />,
      );
      expect(screen.queryByText('Live')).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('states the exact age, the measurement time and the retrieval time', () => {
    render(
      <FreshnessIndicator
        freshness="stale"
        measuredAt="2026-07-26T06:00:00Z"
        fetchedAt="2026-07-26T14:29:00Z"
        nowIso="2026-07-26T14:30:00Z"
      />,
    );

    expect(screen.getByText('8 hours old')).toBeInTheDocument();
    // Malta time, not UTC: 06:00Z is 08:00 in July.
    expect(screen.getByText('Sun 26 Jul, 08:00')).toBeInTheDocument();
    expect(screen.getByText('Sun 26 Jul, 16:29')).toBeInTheDocument();
  });

  it('omits a timestamp it cannot parse rather than printing "Not available" inside a <time>', () => {
    const { container } = render(
      <FreshnessIndicator freshness="unavailable" measuredAt="not-a-timestamp" />,
    );

    expect(container.querySelector('time')).toBeNull();
    expect(screen.queryByText(/Measured at/)).not.toBeInTheDocument();
  });

  it('says the age is unknown rather than staying silent about it', () => {
    render(<FreshnessIndicator freshness="unavailable" measuredAt={null} />);
    expect(screen.getByText('Age unknown')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });
});
