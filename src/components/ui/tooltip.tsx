'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type * as React from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Tooltip.
 *
 * Supplementary only. A tooltip is unreachable by touch, disappears on scroll
 * and is easy to miss, so it must never be the sole carrier of information — no
 * measurement time, freshness state or health advice may live only in here. Use
 * it to expand on something already written on the page.
 *
 * `disableHoverableContent` is left off so a user can move the pointer into the
 * tooltip to read a long note without it vanishing.
 */
export function TooltipProvider({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

/**
 * Wraps itself in a provider, so a single tooltip works without app-level setup.
 * Nesting providers is harmless; mount one high in the tree if you want shared
 * delay behaviour across many tooltips.
 */
export function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

export function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'rounded-card bg-foreground text-background shadow-panel z-50 max-w-xs px-3 py-2 text-xs leading-relaxed',
          'data-[state=delayed-open]:animate-fade-in data-[state=closed]:animate-fade-out',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-foreground" width={10} height={5} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
