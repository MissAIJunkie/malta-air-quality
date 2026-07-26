import { expect, test, type Page } from '@playwright/test';

import {
  POLLUTANT_PATTERNS,
  STATION_WITHOUT_OZONE,
  findPollutantFilter,
  firstVisible,
  guardAgainstPageErrors,
  revealListing,
  skipBecauseAbsent,
  visit,
} from './helpers';

/**
 * Choose a pollutant in whatever control shape the filter turns out to be:
 * a native `<select>`, a Radix combobox, a tab list or a radio group.
 */
async function choosePollutant(page: Page, label: RegExp): Promise<boolean> {
  const tab = await firstVisible(
    page.getByRole('tab', { name: label }),
    page.getByRole('radio', { name: label }),
    page.getByRole('button', { name: label }),
  );
  if (tab) {
    /*
     * The filter styles a wrapping `<label>` and clips the radio itself to a
     * screen-reader-only box. That is a normal, accessible pattern, but it means
     * the input is not the thing a pointer can reach — the label sits over it.
     * Drive the label when there is one, exactly as a person would.
     */
    const wrappingLabel = tab.locator('xpath=ancestor::label[1]');
    const target = (await wrappingLabel.count()) > 0 ? wrappingLabel.first() : tab;
    await target.scrollIntoViewIfNeeded();
    await target.click();
    return true;
  }

  const combobox = await firstVisible(page.getByRole('combobox', { name: /pollutant/i }));
  if (!combobox) return false;

  // A native <select> is set directly; a Radix trigger has to be opened first.
  const tagName = await combobox.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'select') {
    const option = combobox.locator('option').filter({ hasText: label }).first();
    if ((await option.count()) === 0) return false;
    const value = await option.getAttribute('value');
    if (value === null) return false;
    await combobox.selectOption(value);
    return true;
  }

  await combobox.click();
  const option = await firstVisible(page.getByRole('option', { name: label }));
  if (!option) return false;
  await option.click();
  return true;
}

test.describe('switching pollutants', () => {
  guardAgainstPageErrors();

  test.beforeEach(async ({ page }) => {
    await visit(page, '/');
    await revealListing(page);
  });

  test('offers a labelled pollutant filter', async ({ page }) => {
    const filter = await findPollutantFilter(page);
    if (!filter) skipBecauseAbsent('this build has no pollutant filter');

    /*
     * A control with no accessible name is unusable by a screen reader, however
     * obvious it looks on screen.
     *
     * `<legend>` counts. A fieldset labelled by its legend is the most
     * conventional way to name a group of radios, and demanding `aria-label`
     * specifically would fail the markup that needs it least — the locator above
     * already matched this element BY its accessible name, so a name exists.
     */
    const name = await filter.getAttribute('aria-label');
    const labelledBy = await filter.getAttribute('aria-labelledby');
    const legend = await filter
      .locator('legend')
      .first()
      .textContent()
      .catch(() => null);

    expect(
      Boolean(name || labelledBy || legend?.trim()),
      'the pollutant filter has no accessible name',
    ).toBe(true);
  });

  test('changes what the page shows when a pollutant is chosen', async ({ page }) => {
    const filter = await findPollutantFilter(page);
    if (!filter) skipBecauseAbsent('this build has no pollutant filter');

    const before = await page.locator('main').innerText();
    const switched = await choosePollutant(page, POLLUTANT_PATTERNS.PM10);
    if (!switched) skipBecauseAbsent('could not operate the pollutant filter');

    await expect
      .poll(async () => (await page.locator('main').innerText()) !== before, {
        message: 'choosing PM10 changed nothing on the page',
        timeout: 10_000,
      })
      .toBe(true);
  });

  test('reports a station that does not measure the chosen pollutant as unavailable', async ({
    page,
  }) => {
    const filter = await findPollutantFilter(page);
    if (!filter) skipBecauseAbsent('this build has no pollutant filter');

    const switched = await choosePollutant(page, POLLUTANT_PATTERNS.O3);
    if (!switched) skipBecauseAbsent('ozone is not offered by the filter');

    // Msida measures no ozone. Under an ozone filter it must read as having no
    // data — not as Good, and not as 0 µg/m³.
    const row = page
      .getByRole('listitem')
      .filter({ hasText: STATION_WITHOUT_OZONE.pattern })
      .or(page.getByRole('row').filter({ hasText: STATION_WITHOUT_OZONE.pattern }));

    if ((await row.count()) === 0) skipBecauseAbsent('no per-station row to inspect');

    const text = await row.first().innerText();
    expect(text).toMatch(/no data|not (available|measured)|n\/a/i);
    expect(text, 'Msida shows a numeric ozone concentration it cannot have').not.toMatch(
      /\b0(\.0+)?\s*µg/i,
    );
  });

  test('keeps the chosen pollutant in the URL, so a filtered view is shareable', async ({
    page,
  }) => {
    const filter = await findPollutantFilter(page);
    if (!filter) skipBecauseAbsent('this build has no pollutant filter');

    const switched = await choosePollutant(page, POLLUTANT_PATTERNS.NO2);
    if (!switched) skipBecauseAbsent('could not operate the pollutant filter');

    // Optional but valuable. If the URL does not carry the filter, the test says
    // so by skipping rather than by failing a design decision.
    await page.waitForTimeout(500);
    if (!/no2|pollutant=/i.test(page.url())) {
      skipBecauseAbsent('this build does not reflect the filter in the URL');
    }
    expect(page.url()).toMatch(/no2/i);
  });

  test('explains each pollutant in words, not just as a formula', async ({ page }) => {
    const body = await page.locator('body').innerText();
    const namesSomething = /particulate|nitrogen dioxide|ozone|sulphur dioxide/i.test(body);

    if (!namesSomething) {
      const link = await firstVisible(
        page.getByRole('link', { name: /pollutant|about|learn|what (is|are)/i }),
      );
      if (!link) skipBecauseAbsent('no pollutant explanations on this page');
      await link.click();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).toContainText(
        /particulate|nitrogen dioxide|ozone|sulphur dioxide/i,
      );
      return;
    }

    expect(namesSomething).toBe(true);
  });
});

test.describe('health guidance', () => {
  guardAgainstPageErrors();

  test('carries the medical disclaimer wherever advice is given', async ({ page }) => {
    await visit(page, '/');

    const body = await page.locator('body').innerText();
    const givesAdvice = /(sensitive|reduce|limit|consider|avoid|indoors|strenuous)/i.test(body);
    if (!givesAdvice) skipBecauseAbsent('no health guidance rendered on this page');

    // Non-negotiable wherever guidance appears.
    expect(body).toMatch(/does not replace medical advice/i);
  });

  test('never claims a single hourly reading breaches an annual legal limit', async ({ page }) => {
    await visit(page, '/');

    const body = await page.locator('body').innerText();
    // An annual limit cannot be settled by one hour. If the page mentions one,
    // it must hedge rather than assert a breach.
    const claimsAnnualBreach =
      /(annual|calendar year)[^.]{0,80}(exceed|breach|above the limit)/i.test(body) &&
      !/(cannot|not enough|indicative|would need|does not prove|single hour)/i.test(body);
    expect(claimsAnnualBreach, 'the page asserts an annual limit breach from hourly data').toBe(
      false,
    );
  });
});
