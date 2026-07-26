/**
 * Public entry point for internationalisation.
 *
 * Import from `@/lib/i18n` rather than from the individual modules, so the
 * split between the dictionary and the formatters can change without touching
 * call sites.
 */

export {
  AVAILABLE_LOCALES,
  CATEGORY_KEY_SEGMENT,
  DEFAULT_LOCALE,
  NO_DATA_KEY_SEGMENT,
  SENSITIVE_GROUPS,
  SUPPORTED_LOCALES,
  categoryDescriptionKey,
  categoryHealthKey,
  categoryLabelKey,
  categorySegment,
  categoryShortAdviceKey,
  dictionaries,
  getDictionary,
  hasKey,
  isLocale,
  sensitiveGroupAdviceKey,
  sensitiveGroupLabelKey,
  t,
  type Dictionary,
  type DictionaryKey,
  type Locale,
  type SensitiveGroup,
} from './dictionary';

export {
  DATE_PATTERNS,
  MaltaDate,
  NOT_AVAILABLE_KEY,
  formatConcentration,
  formatConcentrationParts,
  formatCoordinates,
  formatDateInMalta,
  formatDistanceKm,
  formatInMalta,
  formatList,
  formatMeasuredAt,
  formatMeasuredAtLong,
  formatNumber,
  formatRelativeAge,
  formatSubIndex,
  formatTimeInMalta,
  isUnavailableText,
  notAvailable,
  toDateTimeAttribute,
  toMaltaDate,
  type ConcentrationParts,
} from './format';
