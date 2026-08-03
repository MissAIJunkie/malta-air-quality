import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Shared shell for the long-form pages: About, Methodology and Privacy.
 *
 * These pages are read rather than scanned, so the measure is capped at roughly
 * 70 characters and the vertical rhythm is generous. Headings are real `h1`/`h2`
 * elements in document order — the outline is how a screen-reader user moves
 * through a page this long.
 */
export function ContentPage({
  title,
  lead,
  children,
  aside,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
  /** Optional strapline under the lead, e.g. a "last reviewed" date. */
  aside?: ReactNode;
}) {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14"
    >
      <header className="flex flex-col gap-3">
        {/* Weight comes from the base heading rule (700, display face) — the
            title is the one display moment a content page gets. */}
        <h1 className="text-foreground text-4xl tracking-tight text-balance sm:text-5xl">
          {title}
        </h1>
        {lead ? <p className="text-muted-foreground text-lg leading-relaxed">{lead}</p> : null}
        {aside}
      </header>
      {children}
    </main>
  );
}

/**
 * A titled section.
 *
 * `aria-labelledby` rather than `aria-label`, so the accessible name is the
 * heading itself and the two can never say different things.
 */
export function ContentSection({
  id,
  heading,
  children,
  className,
}: {
  id: string;
  heading: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-4', className)}>
      <h2 id={id} className="text-foreground text-xl tracking-tight sm:text-2xl">
        {heading}
      </h2>
      {children}
    </section>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-foreground mt-2 text-base font-semibold">{children}</h3>;
}

export function Paragraph({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-base leading-relaxed">{children}</p>;
}

export function BulletList({ children }: { children: ReactNode }) {
  return (
    <ul className="text-muted-foreground marker:text-subtle flex list-disc flex-col gap-2 pl-5 text-base leading-relaxed">
      {children}
    </ul>
  );
}

/** A pulled-out statement that must not be missed — a limit, a caveat, a promise. */
export function Callout({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <p
      className={cn(
        'rounded-card border p-4 text-sm leading-relaxed',
        tone === 'warning'
          ? 'border-border-strong bg-surface text-foreground font-medium'
          : 'border-border bg-surface-sunken text-foreground',
      )}
    >
      {children}
    </p>
  );
}

/**
 * Definition list for the many "term — what it means" pairs these pages need.
 * A real `<dl>`, so the pairing survives being read out of visual order.
 */
export function DefinitionList({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-4">{children}</dl>;
}

export function Definition({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-foreground text-sm font-semibold">{term}</dt>
      <dd className="text-muted-foreground text-base leading-relaxed">{children}</dd>
    </div>
  );
}

/**
 * Horizontally scrollable table wrapper.
 *
 * A wide table must scroll inside its own box rather than making the whole page
 * scroll sideways, and the scroll container needs to be focusable so it can be
 * reached and panned from the keyboard.
 */
export function TableScroll({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      /* `relative`: see station-list. Absolutely-positioned `sr-only` content
         inside a wide table would otherwise escape this clip and widen the
         document rather than scrolling within this region. */
      className="border-border rounded-card relative overflow-x-auto border"
    >
      {children}
    </div>
  );
}
