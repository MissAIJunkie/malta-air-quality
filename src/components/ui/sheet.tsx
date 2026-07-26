'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Edge-anchored panel, built on the same Radix dialog as `Dialog`.
 *
 * Used for the station detail panel and the mobile navigation. It is a genuine
 * modal: focus is trapped and the rest of the page is inert, so a keyboard user
 * cannot tab into content hidden behind it.
 *
 * As with `Dialog`, a `SheetTitle` is mandatory.
 */
export function Sheet(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

export function SheetTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

export function SheetClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

export type SheetSide = 'top' | 'right' | 'bottom' | 'left';

const SIDE_CLASSES: Record<SheetSide, string> = {
  right:
    'inset-y-0 right-0 h-full w-full max-w-md border-l data-[state=open]:animate-slide-in-from-right data-[state=closed]:animate-slide-out-to-right',
  left: 'inset-y-0 left-0 h-full w-full max-w-md border-r data-[state=open]:animate-slide-in-from-left data-[state=closed]:animate-slide-out-to-left',
  top: 'inset-x-0 top-0 max-h-[85dvh] w-full border-b data-[state=open]:animate-slide-in-from-top data-[state=closed]:animate-slide-out-to-top',
  bottom:
    'inset-x-0 bottom-0 max-h-[85dvh] w-full border-t data-[state=open]:animate-slide-in-from-bottom data-[state=closed]:animate-slide-out-to-bottom',
};

export type SheetContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: SheetSide;
  /** Text for the built-in close control. Required: it must not be icon-only. */
  closeLabel: string;
  showCloseButton?: boolean;
};

export function SheetContent({
  className,
  children,
  side = 'right',
  closeLabel,
  showCloseButton = true,
  ...props
}: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="sheet-overlay"
        className="bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out fixed inset-0 z-50"
      />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'border-border bg-surface text-foreground shadow-panel fixed z-50 flex flex-col gap-4 overflow-y-auto p-6',
          SIDE_CLASSES[side],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className={cn(
              'rounded-card absolute top-4 right-4 inline-flex size-11 items-center justify-center',
              'text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
            )}
          >
            <X className="size-5" aria-hidden="true" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 pr-12', className)}
      {...props}
    />
  );
}

export function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('border-border mt-auto flex flex-col gap-2 border-t pt-4', className)}
      {...props}
    />
  );
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-lg leading-tight font-semibold', className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-muted-foreground text-sm leading-relaxed', className)}
      {...props}
    />
  );
}
