import type * as React from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Text available to assistive technology but not shown on screen.
 *
 * Clipped rather than `display: none` or `visibility: hidden`, both of which
 * remove the element from the accessibility tree entirely — the opposite of the
 * intent. Used throughout for the written half of anything that would otherwise
 * be an icon or a colour on its own.
 */
export function VisuallyHidden({
  className,
  as: Component = 'span',
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: 'span' | 'div' | 'p' }) {
  return <Component data-slot="visually-hidden" className={cn('sr-only', className)} {...props} />;
}
