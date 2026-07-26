'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Has the component hydrated?
 *
 * `useSyncExternalStore` with a never-firing subscription is the sanctioned way
 * to ask this: it returns the server snapshot during SSR and the client
 * snapshot afterwards, with no state update and therefore no cascading render.
 * The older `useState` + `useEffect(() => setMounted(true))` idiom does the same
 * job by deliberately triggering a second render, which the React Compiler
 * rightly flags.
 */
const NEVER_CHANGES = () => () => {};
const ON_CLIENT = () => true;
const ON_SERVER = () => false;

type ThemeOption = {
  value: 'light' | 'dark' | 'system';
  labelKey: string;
  icon: LucideIcon;
};

const OPTIONS: ThemeOption[] = [
  { value: 'light', labelKey: 'theme.light', icon: Sun },
  { value: 'dark', labelKey: 'theme.dark', icon: Moon },
  { value: 'system', labelKey: 'theme.system', icon: Monitor },
];

export type ThemeToggleProps = {
  /** Resolved labels, passed down so the client bundle carries no dictionary. */
  labels: {
    group: string;
    light: string;
    dark: string;
    system: string;
  };
  className?: string;
};

/**
 * Appearance selector.
 *
 * A radio group rather than a two-state switch, because "match device" is a real
 * third choice and collapsing it into a toggle would silently discard someone's
 * system preference.
 *
 * Nothing renders the current selection until after mount. The server has no way
 * to know which theme the browser resolved from `localStorage` or from
 * `prefers-color-scheme`, so marking an option as selected during SSR would
 * guarantee a hydration mismatch. A placeholder of identical size is rendered
 * instead, which also keeps the header from reflowing when the real control
 * appears.
 */
export function ThemeToggle({ labels, className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(NEVER_CHANGES, ON_CLIENT, ON_SERVER);

  const label = (option: ThemeOption): string =>
    option.value === 'light' ? labels.light : option.value === 'dark' ? labels.dark : labels.system;

  return (
    <div
      role="radiogroup"
      aria-label={labels.group}
      className={cn(
        'border-border bg-surface-sunken inline-flex items-center gap-0.5 rounded-full border p-0.5',
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = mounted && theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            // Only the selected control stays in the tab order; arrow keys are
            // not implemented, so every option keeps its own tab stop until a
            // selection is known. Before mount nothing is selected, so all three
            // remain reachable.
            title={label(option)}
            onClick={() => setTheme(option.value)}
            className={cn(
              // 44 px: the brief's minimum pointer target, stricter than WCAG 2.2 AA.
              'inline-flex size-11 items-center justify-center rounded-full transition-colors',
              'text-muted-foreground hover:text-foreground hover:bg-muted',
              selected && 'bg-surface text-foreground shadow-card',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="sr-only">{label(option)}</span>
          </button>
        );
      })}
    </div>
  );
}
