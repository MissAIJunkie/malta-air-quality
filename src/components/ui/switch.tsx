'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import type * as React from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Switch.
 *
 * The thumb moves as well as changing colour, so the state is legible without
 * colour vision, and the whole control sits inside a 44px hit area even though
 * the track itself is smaller.
 *
 * Always give it an accessible name: pair it with `<Label htmlFor>` or pass
 * `aria-label`.
 */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors',
        'bg-border-strong data-[state=checked]:bg-primary',
        'disabled:cursor-not-allowed disabled:opacity-60',
        // Extends the pointer target to 44px without enlarging the visual track.
        'after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[""]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'bg-surface shadow-card pointer-events-none block size-5 rounded-full transition-transform',
          'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
