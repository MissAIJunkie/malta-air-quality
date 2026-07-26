/**
 * Skip link.
 *
 * The first focusable element in the document, so a keyboard user can jump past
 * the header on every page. The visual behaviour lives in the `.skip-link` rule
 * in globals.css: moved out of view rather than hidden, because `display: none`
 * would make it unfocusable and therefore useless.
 *
 * The target is `#main`, which the root layout puts on the `<main>` element.
 */

import { getDictionary, t } from '@/lib/i18n';

export function SkipLink({ targetId = 'main' }: { targetId?: string }) {
  const dict = getDictionary();

  return (
    <a className="skip-link" href={`#${targetId}`}>
      {t(dict, 'a11y.skipToContent')}
    </a>
  );
}
