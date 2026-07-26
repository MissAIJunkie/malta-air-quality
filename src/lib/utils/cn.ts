import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose class names, letting later Tailwind utilities win over earlier ones.
 *
 * `clsx` handles conditionals; `twMerge` resolves genuine conflicts (`p-2 p-4`
 * → `p-4`) so a caller's `className` prop can always override a component's
 * defaults without `!important` or ordering tricks.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
