'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils/cn';

export type MenuLink = {
  href: string;
  label: string;
  description: string;
};

export type MobileMenuProps = {
  primary: MenuLink[];
  information: MenuLink[];
  labels: {
    trigger: string;
    title: string;
    description: string;
    close: string;
    informationHeading: string;
    currentPage: string;
  };
  /** The appearance control, rendered by the server and slotted in here. */
  appearance: ReactNode;
};

/**
 * Compact navigation for narrow screens.
 *
 * A Sheet rather than a dropdown menu: the target is a map-first page held in
 * one hand, where a full-height panel with 44 px rows is far easier to hit than
 * a floating list. Radix handles the focus trap, the Escape key and returning
 * focus to the trigger on close.
 *
 * The trigger is not icon-only — the icon is paired with a visible "Menu" label
 * from `sm` down, and always carries an accessible name.
 */
export function MobileMenu({ primary, information, labels, appearance }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const renderLink = (item: MenuLink) => {
    // Exact match for the home route; prefix match elsewhere, so a future
    // /methodology/aqi still marks Methodology as current.
    const current =
      item.href === '/'
        ? pathname === '/'
        : pathname === item.href || pathname.startsWith(`${item.href}/`);

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={current ? 'page' : undefined}
          onClick={() => setOpen(false)}
          className={cn(
            'rounded-card flex min-h-11 flex-col justify-center gap-0.5 px-3 py-2.5 transition-colors',
            'hover:bg-muted',
            current && 'bg-muted',
          )}
        >
          <span className="text-foreground flex items-center gap-2 text-sm font-medium">
            {item.label}
            {current ? <span className="sr-only">({labels.currentPage})</span> : null}
          </span>
          <span className="text-muted-foreground text-xs leading-snug">{item.description}</span>
        </Link>
      </li>
    );
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'rounded-card border-border bg-surface text-foreground inline-flex h-11 items-center gap-2 border px-3',
          'hover:bg-muted text-sm font-medium transition-colors',
        )}
      >
        <Menu className="size-4" aria-hidden="true" />
        {labels.trigger}
      </button>

      <SheetContent side="right" closeLabel={labels.close} className="gap-6">
        <SheetHeader>
          <SheetTitle>{labels.title}</SheetTitle>
          <SheetDescription>{labels.description}</SheetDescription>
        </SheetHeader>

        <nav aria-label={labels.title}>
          <ul className="flex flex-col gap-1">{primary.map(renderLink)}</ul>

          <h3 className="text-muted-foreground mt-5 mb-1 px-3 text-xs font-semibold tracking-wide uppercase">
            {labels.informationHeading}
          </h3>
          <ul className="flex flex-col gap-1">{information.map(renderLink)}</ul>
        </nav>

        <div className="border-border mt-auto border-t pt-4">{appearance}</div>
      </SheetContent>
    </Sheet>
  );
}
