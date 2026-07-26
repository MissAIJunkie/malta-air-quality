import { expect, test } from '@playwright/test';

import {
  STATIONS,
  findAnyStationTarget,
  findStationListing,
  firstVisible,
  guardAgainstPageErrors,
  revealListing,
  skipBecauseAbsent,
  stationTargets,
  tabUntil,
  visit,
} from './helpers';

test.describe('the station network', () => {
  guardAgainstPageErrors();

  test.beforeEach(async ({ page }) => {
    await visit(page, '/');
    await revealListing(page);
  });

  test('names all five stations somewhere a screen reader can reach', async ({ page }) => {
    const listing = await findStationListing(page);
    expect(listing, 'no accessible station listing rendered').not.toBeNull();

    for (const station of STATIONS) {
      await expect(
        page.getByText(station.pattern).first(),
        `station ${station.name} is not named on the page`,
      ).toBeVisible();
    }
  });

  test('spells Maltese place names correctly', async ({ page }) => {
    // Żejtun and Għarb, not Zejtun and Gharb. The upstream anglicises them; we
    // do not, and a regression here is the kind that quietly ships.
    const text = await page.locator('body').innerText();
    expect(text).toContain('Żejtun');
    expect(text).toContain('Għarb');
  });

  test('renders either a map or a list, and never only a map', async ({ page }) => {
    const map = await firstVisible(
      page.getByRole('region', { name: /map/i }),
      page.locator('canvas.maplibregl-canvas'),
      page.locator('[data-slot="station-map"]'),
    );

    // The map is optional. The listing is not: colour on a canvas is not an
    // accessible presentation of the data on its own.
    const listing = await findStationListing(page);
    expect(listing, 'the data must be reachable without the map').not.toBeNull();

    if (map) {
      // A canvas carries no semantics, so it needs a name and a text
      // alternative alongside it.
      const label = await map.getAttribute('aria-label');
      const labelledBy = await map.getAttribute('aria-labelledby');
      expect(Boolean(label || labelledBy), 'the map region has no accessible name').toBe(true);
    }
  });

  test('opens a station and shows its reading', async ({ page }) => {
    const target = await findAnyStationTarget(page);
    if (!target) skipBecauseAbsent('no station links or buttons are rendered yet');

    const name = ((await target.textContent()) ?? '').trim();
    await target.click();
    await page.waitForLoadState('domcontentloaded');

    // Whether it navigated or opened a panel, the station must now be named in
    // a heading or a dialog title, and its measurement time stated.
    const revealed = await firstVisible(
      page.getByRole('heading', { name: new RegExp(name.slice(0, 6), 'i') }),
      page.getByRole('dialog'),
      page.getByRole('complementary'),
    );
    expect(revealed, `selecting "${name}" revealed nothing`).not.toBeNull();
    await expect(page.locator('time[datetime]').first()).toHaveCount(1);
  });

  test('reaches a station with the keyboard alone and activates it with Enter', async ({
    page,
  }) => {
    const target = await findAnyStationTarget(page);
    if (!target) skipBecauseAbsent('no station links or buttons are rendered yet');

    const stationPattern = /Ż?ejtun|G(ħ|h)arb|Attard|St\.?\s*Paul|Msida/i;
    const focusedName = await tabUntil(page, (info) => stationPattern.test(info.name));
    expect(focusedName, 'no station is reachable by tabbing').not.toBeNull();

    // WCAG 2.4.7: the focused control must be visibly distinguishable.
    const outlineIsVisible = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const style = getComputedStyle(el);
      return (
        style.outlineStyle !== 'none' ||
        style.boxShadow !== 'none' ||
        Number.parseFloat(style.outlineWidth) > 0
      );
    });
    expect(outlineIsVisible, 'the focused station has no visible focus indicator').toBe(true);

    const before = page.url();
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');

    const opened = await firstVisible(
      page.getByRole('dialog'),
      page.getByRole('heading', { level: 1 }),
    );
    expect(page.url() !== before || opened !== null, 'Enter did nothing').toBe(true);
  });
});

test.describe('a station detail page', () => {
  guardAgainstPageErrors();

  for (const station of STATIONS) {
    test(`shows ${station.name} with its measurement time and provenance`, async ({ page }) => {
      // Slug-addressable detail pages are the shareable, linkable form of the
      // data. Both plausible URL shapes are tried before giving up.
      const candidates = [`/stations/${station.slug}`, `/station/${station.slug}`];

      let loaded = false;
      for (const path of candidates) {
        const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
        if (response && response.status() < 400) {
          loaded = true;
          break;
        }
      }
      if (!loaded) skipBecauseAbsent(`no detail page at ${candidates.join(' or ')}`);

      await expect(page.getByRole('heading', { level: 1 })).toContainText(station.pattern);
      await expect(page.locator('time[datetime]').first()).toBeVisible();
      // Provenance travels with the data, not only with the front page.
      await expect(page.locator('body')).toContainText(/Environment and Resources Authority/i);
    });
  }

  test('says so plainly when a station does not measure a pollutant', async ({ page }) => {
    // Msida measures no ozone. The detail page must say that in words rather
    // than printing 0 µg/m³ or quietly omitting the row.
    const response = await page.goto('/stations/msida', { waitUntil: 'domcontentloaded' });
    if (!response || response.status() >= 400) skipBecauseAbsent('no Msida detail page');

    const body = page.locator('body');
    const text = await body.innerText();

    if (!/O(₃|3)|ozone/i.test(text)) {
      // Omitting ozone entirely is a defensible design; claiming a value is not.
      return;
    }
    expect(text).toMatch(/not (available|measured)|no (value|data)/i);
    expect(text).not.toMatch(/O(₃|3)[^\n]{0,40}\b0(\.0+)?\s*µg/i);
  });

  test('returns a real 404 for a station that does not exist', async ({ page }) => {
    const response = await page.goto('/stations/atlantis', { waitUntil: 'domcontentloaded' });
    if (!response) skipBecauseAbsent('no response for the unknown-station URL');
    // Either a 404 status or a 404 page — but never a page pretending the
    // station exists with empty readings.
    if (response.status() < 400) {
      await expect(page.locator('body')).toContainText(/not found|does not exist|unknown/i);
    }
  });
});

test.describe('deep links', () => {
  guardAgainstPageErrors();

  test('a shared station URL loads that station directly', async ({ page }) => {
    const response = await page.goto('/stations/gharb', { waitUntil: 'domcontentloaded' });
    if (!response || response.status() >= 400) skipBecauseAbsent('no slug-addressable detail page');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/G(ħ|h)arb/i);
    // Gozo, not Malta — the island is part of what makes the reading meaningful.
    await expect(page.locator('body')).toContainText(/Gozo/i);
  });

  test('a station link on the front page points at that station', async ({ page }) => {
    await visit(page, '/');
    await revealListing(page);

    const link = await firstVisible(stationTargets(page, /Msida/i));
    if (!link) skipBecauseAbsent('Msida is not linked from the front page');

    const href = await link.getAttribute('href');
    if (href === null) skipBecauseAbsent('the station affordance is a button, not a link');
    expect(href).toContain('msida');
  });
});
