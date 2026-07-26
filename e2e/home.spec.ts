import { expect, test } from '@playwright/test';

import {
  LIVENESS_CLAIM,
  findStationListing,
  guardAgainstPageErrors,
  revealListing,
  visit,
} from './helpers';

test.describe('the front page', () => {
  guardAgainstPageErrors();

  test('loads, names itself and renders one main heading', async ({ page }) => {
    await visit(page, '/');

    await expect(page).toHaveTitle(/./);
    // Exactly one h1: assistive technology uses it as the page's identity, and a
    // second one makes the document outline ambiguous.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('offers a skip link that reaches the main content', async ({ page }) => {
    await visit(page, '/');

    // WCAG 2.4.1. It may be visually hidden until focused, so it is found by
    // role rather than by visibility.
    const skipLink = page.getByRole('link', { name: /skip (to|nav)/i }).first();
    await expect(skipLink).toHaveCount(1);

    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    // Visible focus is the point of a skip link — an invisible one is useless.
    await expect(skipLink).toBeVisible();

    const href = await skipLink.getAttribute('href');
    expect(href).toMatch(/^#/);
    await expect(page.locator(href as string)).toHaveCount(1);
  });

  test('credits ERA as the data owner and the EEA as the channel', async ({ page }) => {
    await visit(page, '/');

    // Non-negotiable. The data is Malta's ERA's; the EEA only disseminates it,
    // and maqua.app is independent of both.
    const body = page.locator('body');
    await expect(body).toContainText(/Environment and Resources Authority/i);
    await expect(body).toContainText(/European Environment Agency/i);
    await expect(body).toContainText(/independent project/i);
    await expect(body).toContainText(/not operated by, affiliated with, or endorsed by/i);
  });

  test('states when the reading was taken and when it was retrieved', async ({ page }) => {
    await visit(page, '/');

    // A number without a time is not a measurement, it is a rumour.
    await expect(page.locator('body')).toContainText(/measured/i);
    const machineReadable = page.locator('time[datetime]');
    expect(await machineReadable.count()).toBeGreaterThan(0);

    const datetime = await machineReadable.first().getAttribute('datetime');
    expect(Number.isFinite(Date.parse(datetime as string))).toBe(true);
  });

  test('never calls the data live while also reporting it out of date', async ({ page }) => {
    await visit(page, '/');

    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const claimsLive = LIVENESS_CLAIM.test(text);
    const admitsStale = /(stale|out of date|delayed|unavailable|no recent data)/i.test(text);

    // The pair is the contradiction. Either alone is fine.
    expect(
      claimsLive && admitsStale,
      `page claims live data and simultaneously reports it as not current:\n${text.slice(0, 600)}`,
    ).toBe(false);
  });

  test('shows the station network without requiring the map', async ({ page }) => {
    await visit(page, '/');
    await revealListing(page);

    // The map is an enhancement; the data behind it must be reachable without
    // WebGL, without a pointing device and without JavaScript-driven panning.
    const listing = await findStationListing(page);
    expect(listing, 'no accessible station listing found on the front page').not.toBeNull();
  });

  test('serves the air-quality API from fixture data, with honest metadata', async ({
    request,
  }) => {
    const response = await request.get('/api/air-quality');
    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      data?: {
        stations?: Array<{
          stationId: string;
          pollutants: Record<string, { value: number | null } | undefined>;
        }>;
        summary?: { totalStations?: number; reportingStations?: number };
      };
      meta?: { source?: string; measuredAt?: string | null; fetchedAt?: string; stale?: boolean };
    };

    // Fixture data must announce itself. If this ever says EEA in a test run,
    // the suite has reached the real upstream.
    expect(body.meta?.source).toBe('FIXTURE');
    expect(Number.isFinite(Date.parse(body.meta?.fetchedAt ?? ''))).toBe(true);
    expect(typeof body.meta?.stale).toBe('boolean');
    expect(body.data?.stations).toHaveLength(5);
    expect(body.data?.summary?.totalStations).toBe(5);

    // An unmeasured pollutant is absent from the payload. It is never present
    // carrying a value of 0 or null, either of which a client could render as
    // a measurement of clean air.
    for (const station of body.data?.stations ?? []) {
      for (const reading of Object.values(station.pollutants)) {
        expect(
          reading?.value,
          `${station.stationId} published a null concentration`,
        ).not.toBeNull();
      }
    }
  });

  test('rejects a malformed query rather than guessing what was meant', async ({ request }) => {
    const response = await request.get('/api/air-quality?pollutant=plutonium');
    expect(response.status()).toBe(400);
  });
});
