'use client';

import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Accordion.
 *
 * Used for pollutant explanations and the questions page.
 */
export function Accordion(props: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

export function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('border-border border-b last:border-b-0', className)}
      {...props}
    />
  );
}

export type AccordionTriggerProps = React.ComponentProps<typeof AccordionPrimitive.Trigger> & {
  /**
   * Depth of the section in the document outline.
   *
   * Radix's `Header` renders a `div` with `role="heading"`; substituting a real
   * heading element via `asChild` navigates far more reliably in screen readers,
   * and forces each caller to place its sections at the correct level instead of
   * every accordion in the app claiming `h3`.
   */
  headingLevel?: 'h2' | 'h3' | 'h4';
};

export function AccordionTrigger({
  className,
  children,
  headingLevel = 'h3',
  ...props
}: AccordionTriggerProps) {
  const Heading = headingLevel;

  return (
    <AccordionPrimitive.Header asChild>
      <Heading className="flex">
        <AccordionPrimitive.Trigger
          data-slot="accordion-trigger"
          className={cn(
            'flex min-h-11 flex-1 items-center justify-between gap-4 py-4 text-left',
            'hover:text-primary text-base font-medium transition-colors',
            '[&[data-state=open]>svg]:rotate-180',
            className,
          )}
          {...props}
        >
          {children}
          <ChevronDown
            className="text-muted-foreground size-5 shrink-0 transition-transform duration-200"
            aria-hidden="true"
          />
        </AccordionPrimitive.Trigger>
      </Heading>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="text-muted-foreground data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden text-sm leading-relaxed"
      {...props}
    >
      <div className={cn('pb-4', className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
