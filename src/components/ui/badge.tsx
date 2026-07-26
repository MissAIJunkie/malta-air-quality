import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Neutral badge.
 *
 * Air-quality status has its own component — `CategoryBadge` — because it must
 * carry a colour, a texture, an icon and a label together. Nothing here uses the
 * band colours: those are reserved for status and must not appear on a "Beta" or
 * "Estimated" chip, where they would imply an air-quality meaning.
 *
 * No `asChild`, and therefore no Radix `Slot`, which pulls in a hook and would
 * force a client boundary. Badges appear in long server-rendered lists; render
 * one inside your own `<a>` or `<button>` if you need it to be interactive.
 */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-3.5',
  {
    variants: {
      variant: {
        neutral: 'bg-muted text-foreground',
        outline: 'border border-border-strong text-foreground',
        primary: 'bg-primary text-primary-foreground',
        accent: 'bg-accent text-accent-foreground',
        danger: 'bg-danger text-danger-foreground',
        subtle: 'bg-surface-sunken text-muted-foreground',
      },
      size: {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'neutral',
      size: 'sm',
    },
  },
);

export type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { badgeVariants };
