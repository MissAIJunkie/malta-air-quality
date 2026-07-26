/**
 * Localised text with a payload-supplied fallback.
 *
 * `t()` returns the KEY when a translation is missing. That is the right
 * behaviour for a static interface string — the key is self-describing and a
 * reviewer spots it immediately — but it is the wrong behaviour for text that
 * arrives on a payload.
 *
 * The forecast and environmental-context pipelines deliberately emit an i18n
 * key *and* the English sentence it stands for (see `EnrichedForecastDriver`
 * and `EnrichedContextEvent`, whose doc comments say exactly why). Rendering
 * `forecast.driver.dust.label` to a member of the public while the sentence sat
 * unread on the same object would be a self-inflicted wound.
 *
 * So: the translation when the dictionary has one, the data's own English
 * otherwise. Placeholders are interpolated either way, so a caller never has to
 * know which branch it got.
 */

import { hasKey, t, type Dictionary } from '@/lib/i18n';

/** Matches `t()`'s own placeholder syntax, so both branches behave identically. */
const INTERPOLATION_PATTERN = /\{(\w+)\}/g;

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(INTERPOLATION_PATTERN, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export function localised(
  dict: Dictionary,
  key: string | undefined | null,
  fallback: string,
  vars?: Record<string, string | number>,
): string {
  if (key && hasKey(dict, key)) return t(dict, key, vars);
  return interpolate(fallback, vars);
}
