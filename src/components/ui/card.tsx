import type * as React from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Surface container.
 *
 * A plain `<div>` by default: a card is a visual grouping, not a landmark.
 * Pass `asSection` where the group genuinely is a document section, and give it
 * a heading via `CardTitle` so the outline stays navigable.
 */
export function Card({
  className,
  asSection = false,
  ...props
}: React.ComponentProps<'div'> & { asSection?: boolean }) {
  const Component = asSection ? 'section' : 'div';

  return (
    <Component
      data-slot="card"
      className={cn(
        'rounded-panel border-border bg-surface text-foreground shadow-card flex flex-col gap-4 border p-5',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-header" className={cn('flex flex-col gap-1.5', className)} {...props} />
  );
}

/**
 * Heading level is explicit and defaults to `h3`.
 *
 * Card titles are usually nested inside a page section, and a document whose
 * headings jump levels is hard to navigate with a screen reader. Callers set the
 * level that matches their position in the outline.
 */
export function CardTitle({
  className,
  as: Component = 'h3',
  ...props
}: React.ComponentProps<'h3'> & { as?: 'h2' | 'h3' | 'h4' | 'h5' }) {
  return (
    <Component
      data-slot="card-title"
      className={cn('text-base leading-tight font-semibold', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-muted-foreground text-sm leading-relaxed', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-content" className={cn('flex flex-col gap-3', className)} {...props} />
  );
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('border-border flex flex-wrap items-center gap-3 border-t pt-4', className)}
      {...props}
    />
  );
}
