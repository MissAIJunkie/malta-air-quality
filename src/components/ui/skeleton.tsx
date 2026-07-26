import type * as React from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Loading placeholder.
 *
 * `aria-hidden` with no text: a skeleton is decorative, and announcing "loading"
 * once per placeholder would flood a screen reader. Put a single polite status
 * message on the region instead.
 *
 * The pulse is suppressed by the global reduced-motion rule in `globals.css`.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('bg-muted animate-pulse rounded-md', className)}
      {...props}
    />
  );
}
