import { describe, expect, it } from 'vitest';

import {
  AIR_QUALITY_CATEGORIES,
  CATEGORY_PRESENTATION,
  NO_DATA_PRESENTATION,
} from '@/config/thresholds';
import { POLLUTANT_CODES, POLLUTANTS } from '@/config/pollutants';
import {
  categoryHealthKey,
  categoryLabelKey,
  categoryShortAdviceKey,
  getDictionary,
  hasKey,
  SENSITIVE_GROUPS,
  sensitiveGroupAdviceKey,
  sensitiveGroupLabelKey,
  t,
} from '../dictionary';
import {
  formatConcentration,
  formatInMalta,
  formatMeasuredAt,
  formatRelativeAge,
  formatSubIndex,
  MaltaDate,
} from '../format';

const dict = getDictionary();

describe('dictionary', () => {
  it('resolves every key the config files reference', () => {
    for (const category of AIR_QUALITY_CATEGORIES) {
      const presentation = CATEGORY_PRESENTATION[category];
      expect(hasKey(dict, presentation.labelKey), presentation.labelKey).toBe(true);
      expect(hasKey(dict, presentation.shortAdviceKey), presentation.shortAdviceKey).toBe(true);
    }
    expect(hasKey(dict, NO_DATA_PRESENTATION.labelKey)).toBe(true);

    for (const code of POLLUTANT_CODES) {
      const pollutant = POLLUTANTS[code];
      expect(hasKey(dict, pollutant.descriptionKey), pollutant.descriptionKey).toBe(true);
      expect(hasKey(dict, pollutant.sourcesKey), pollutant.sourcesKey).toBe(true);
      expect(hasKey(dict, pollutant.healthEffectsKey), pollutant.healthEffectsKey).toBe(true);
    }
  });

  it('resolves the derived category and health keys, including the no-data case', () => {
    for (const category of [...AIR_QUALITY_CATEGORIES, null]) {
      expect(hasKey(dict, categoryLabelKey(category))).toBe(true);
      expect(hasKey(dict, categoryShortAdviceKey(category))).toBe(true);
      expect(hasKey(dict, categoryHealthKey(category, 'general'))).toBe(true);
      expect(hasKey(dict, categoryHealthKey(category, 'sensitive'))).toBe(true);
    }

    for (const group of SENSITIVE_GROUPS) {
      expect(hasKey(dict, sensitiveGroupLabelKey(group))).toBe(true);
      expect(hasKey(dict, sensitiveGroupAdviceKey(group))).toBe(true);
    }
  });

  it('returns the key itself when it is missing, never "undefined"', () => {
    expect(t(dict, 'no.such.key')).toBe('no.such.key');
  });

  it('interpolates variables and leaves unmatched placeholders alone', () => {
    expect(t(dict, 'header.reportingStations', { reporting: 4, total: 5 })).toBe(
      '4 of 5 stations reporting',
    );
    expect(t(dict, 'header.reportingStations', { reporting: 4 })).toContain('{total}');
  });

  it('carries the attribution and medical disclaimer verbatim', () => {
    expect(t(dict, 'footer.attribution')).toBe(
      "Air-quality data provided by Malta's Environment and Resources Authority (ERA), disseminated via the European Environment Agency (EEA). maqua.app is an independent project and is not operated by, affiliated with, or endorsed by ERA or the EEA.",
    );
    expect(t(dict, 'disclaimer.medical')).toBe(
      'maqua.app provides general environmental information and does not replace medical advice or official emergency guidance.',
    );
  });
});

describe('Malta wall clock', () => {
  it('renders summer time as UTC+2', () => {
    expect(formatInMalta('2026-07-26T06:00:00Z', 'yyyy-MM-dd HH:mm')).toBe('2026-07-26 08:00');
  });

  it('renders winter time as UTC+1, rolling the date over', () => {
    expect(formatInMalta('2026-01-15T23:30:00Z', 'yyyy-MM-dd HH:mm')).toBe('2026-01-16 00:30');
  });

  it('follows the spring-forward transition', () => {
    // 01:00 UTC on 29 March 2026 is when Malta moves from CET to CEST.
    expect(formatInMalta('2026-03-29T00:30:00Z', 'HH:mm')).toBe('01:30');
    expect(formatInMalta('2026-03-29T01:30:00Z', 'HH:mm')).toBe('03:30');
  });

  it("reports the Malta offset and weekday, not the host machine's", () => {
    const summer = new MaltaDate('2026-07-26T06:00:00Z');
    expect(summer.getTimezoneOffset()).toBe(-120);
    expect(summer.getDay()).toBe(0); // Sunday
    expect(summer.getHours()).toBe(8);

    expect(new MaltaDate('2026-01-15T23:30:00Z').getTimezoneOffset()).toBe(-60);
  });

  it('never renders an unusable timestamp as a date', () => {
    expect(formatMeasuredAt(null)).toBe('Not available');
    expect(formatMeasuredAt('not-a-timestamp')).toBe('Not available');
  });
});

describe('formatConcentration', () => {
  it('never renders a missing value as zero', () => {
    expect(formatConcentration(null, 'µg/m³')).toBe('Not available');
    expect(formatConcentration(undefined, 'µg/m³')).toBe('Not available');
    expect(formatConcentration(Number.NaN, 'µg/m³')).toBe('Not available');
  });

  it('keeps a genuine zero measurement as a number', () => {
    expect(formatConcentration(0, 'µg/m³')).toContain('0.0');
  });

  it('drops decimals once the value is large enough that they mislead', () => {
    expect(formatConcentration(7.42, 'µg/m³')).toContain('7.4');
    expect(formatConcentration(143.6, 'µg/m³')).toContain('144');
  });
});

describe('formatRelativeAge', () => {
  it('treats a floored zero as "less than an hour", not "0 hours"', () => {
    expect(formatRelativeAge(0)).toBe('Less than an hour old');
  });

  it('states an unknown age rather than implying freshness', () => {
    expect(formatRelativeAge(null)).toBe('Age unknown');
    expect(formatRelativeAge(undefined)).toBe('Age unknown');
  });

  it('counts hours, then days', () => {
    expect(formatRelativeAge(1)).toBe('1 hour old');
    expect(formatRelativeAge(5)).toBe('5 hours old');
    expect(formatRelativeAge(24)).toBe('1 day old');
    expect(formatRelativeAge(50)).toBe('2 days old');
  });

  it('phrases forecast points as being ahead of now', () => {
    expect(formatRelativeAge(-3)).toBe('In about 3 hours');
  });
});

describe('formatSubIndex', () => {
  it('shows one decimal, and nothing at all when there is no index', () => {
    expect(formatSubIndex(3.94)).toBe('3.9');
    expect(formatSubIndex(null)).toBe('Not available');
  });
});
