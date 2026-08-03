'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Every size is at least 2.75rem (44px) tall.
 *
 * The brief sets 44px as the minimum touch target, which is stricter than WCAG
 * 2.2 AA's 24px. `sm` therefore varies padding and type size rather than height:
 * a visually compact button that is still comfortable to hit.
 */
const buttonVariants = cva(
  [
    // Pills: the one soft shape against the tight-radius surfaces, which is
    // what makes a control read as a control at a glance.
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full',
    // The press state is a nearly-instant 2% shrink — felt, not watched.
    'font-medium transition-colors active:scale-[0.98]',
    'disabled:pointer-events-none disabled:opacity-60',
    'aria-disabled:pointer-events-none aria-disabled:opacity-60',
    '[&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-muted',
        outline: 'border border-border-strong bg-surface text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        danger: 'bg-danger text-danger-foreground hover:brightness-110',
        link: 'text-primary underline decoration-from-font underline-offset-4 hover:text-primary-hover',
      },
      size: {
        sm: 'h-11 px-4 text-sm',
        md: 'h-11 px-5 text-sm',
        lg: 'h-12 px-7 text-base',
        icon: 'size-11 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element instead of a `<button>`, keeping the styling. */
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      data-slot="button"
      // An unset `type` inside a form defaults to "submit", which silently
      // submits. Only set it when we are actually rendering a <button>.
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
