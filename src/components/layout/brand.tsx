/**
 * The maqua.app mark and wordmark.
 *
 * The polygons below are byte-identical to those in `public/icon.svg` and to
 * the geometry the PWA rasters were drawn from, so the inline mark in the
 * header, the Open Graph image and the static icon files cannot drift apart.
 *
 * The islands are deliberately STYLISED rather than traced. A faithful
 * coastline turns to noise below about 48 px and this mark has to survive a
 * 16 px browser tab. What is kept faithful is what makes the archipelago
 * recognisable: three landmasses, their relative sizes (Malta is roughly three
 * and a half times Gozo), Gozo to the north-west with Comino in the channel
 * between them, and both main islands elongated along the same NW–SE axis. The
 * two sweeps are an air current, placed in the quadrants the archipelago leaves
 * empty.
 *
 * It is an original drawing and borrows nothing from ERA or EEA branding.
 */

import type * as React from 'react';

import { cn } from '@/lib/utils/cn';

const GOZO_POINTS =
  '43.62,34.7 43.53,35.2 43.41,35.71 43.24,36.22 42.97,36.71 42.58,37.17 42.05,37.57 41.4,37.92 40.65,38.21 39.84,38.45 38.97,38.64 38.07,38.8 37.13,38.93 36.15,39.02 35.12,39.05 34.05,39.01 32.97,38.87 31.9,38.62 30.9,38.27 29.99,37.84 29.2,37.35 28.51,36.84 27.9,36.32 27.33,35.83 26.76,35.36 26.15,34.91 25.49,34.44 24.81,33.95 24.16,33.42 23.59,32.85 23.17,32.25 22.94,31.64 22.94,31.05 23.13,30.49 23.51,29.98 24.02,29.53 24.61,29.12 25.25,28.75 25.93,28.41 26.65,28.11 27.4,27.83 28.22,27.61 29.1,27.44 30.04,27.35 31.01,27.34 32,27.41 32.99,27.52 33.96,27.67 34.91,27.84 35.86,28 36.84,28.17 37.86,28.34 38.91,28.56 39.97,28.83 41.01,29.18 41.96,29.62 42.76,30.14 43.37,30.73 43.77,31.35 43.97,31.97 44.01,32.57 43.95,33.14 43.83,33.68 43.72,34.19';

const COMINO_POINTS =
  '48.03,41.46 47.9,41.63 47.73,41.78 47.53,41.88 47.31,41.96 47.07,42 46.84,42.03 46.61,42.05 46.38,42.07 46.17,42.1 45.94,42.14 45.71,42.18 45.46,42.21 45.19,42.21 44.91,42.18 44.63,42.1 44.36,41.97 44.12,41.8 43.9,41.61 43.72,41.39 43.57,41.17 43.43,40.94 43.32,40.72 43.21,40.5 43.12,40.29 43.03,40.07 42.97,39.85 42.93,39.63 42.92,39.42 42.95,39.21 43.01,39.02 43.09,38.83 43.18,38.66 43.28,38.49 43.39,38.32 43.5,38.15 43.63,37.98 43.79,37.82 43.97,37.68 44.19,37.58 44.44,37.52 44.71,37.51 45,37.56 45.28,37.65 45.54,37.78 45.79,37.92 46.02,38.07 46.24,38.21 46.46,38.34 46.68,38.46 46.91,38.59 47.14,38.72 47.36,38.88 47.57,39.05 47.76,39.25 47.91,39.47 48.03,39.7 48.11,39.93 48.17,40.16 48.2,40.39 48.21,40.61 48.2,40.84 48.17,41.05 48.12,41.26';

const MALTA_POINTS =
  '75.11,70.52 74.3,71.14 73.2,71.47 71.87,71.5 70.4,71.29 68.9,70.92 67.42,70.49 66.01,70.07 64.66,69.7 63.34,69.4 62,69.12 60.59,68.8 59.07,68.36 57.47,67.75 55.82,66.92 54.16,65.89 52.57,64.67 51.08,63.32 49.72,61.89 48.48,60.44 47.36,58.97 46.34,57.52 45.4,56.07 44.56,54.63 43.86,53.22 43.34,51.85 43.05,50.57 43.01,49.4 43.2,48.39 43.59,47.52 44.1,46.77 44.67,46.1 45.23,45.45 45.76,44.77 46.28,44.04 46.83,43.28 47.48,42.56 48.31,41.96 49.36,41.56 50.66,41.46 52.17,41.68 53.83,42.24 55.56,43.09 57.27,44.14 58.92,45.32 60.49,46.54 61.97,47.76 63.39,48.94 64.78,50.11 66.16,51.29 67.52,52.51 68.84,53.78 70.08,55.12 71.19,56.5 72.15,57.9 72.95,59.29 73.62,60.65 74.18,61.99 74.68,63.32 75.11,64.65 75.48,65.98 75.72,67.28 75.79,68.52 75.6,69.62';

const ARC_UPPER = 'M 46.43 9.16 A 41 41 0 0 1 90.38 42.88';
const ARC_LOWER = 'M 53.57 90.84 A 41 41 0 0 1 9.62 57.12';

/** Brand colours, duplicated from globals.css because SVG paint is not a class. */
export const BRAND_COLOURS = {
  deep: '#143c59',
  limestone: '#f3eee3',
  seaglassLight: '#71ceb6',
  seaglassDark: '#1d7767',
} as const;

/**
 * The mark as standalone SVG markup, for contexts that cannot render React.
 *
 * Built from the same constants as the component above, so the two can never
 * disagree. It exists for the Open Graph image: Satori, which renders that, has
 * only partial SVG support and silently drops `transform` and some paths from
 * inline SVG children — but it renders a `data:` URI image faithfully.
 */
export function maquaMarkSvg(): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    `<circle cx="50" cy="50" r="48" fill="${BRAND_COLOURS.deep}"/>`,
    `<g fill="none" stroke="${BRAND_COLOURS.seaglassLight}" stroke-width="5" stroke-linecap="round">`,
    `<path d="${ARC_UPPER}"/><path d="${ARC_LOWER}"/>`,
    '</g>',
    `<g fill="${BRAND_COLOURS.limestone}">`,
    `<polygon points="${GOZO_POINTS}"/>`,
    `<polygon points="${COMINO_POINTS}"/>`,
    `<polygon points="${MALTA_POINTS}"/>`,
    '</g></svg>',
  ].join('');
}

export type MaquaMarkProps = Omit<React.ComponentProps<'svg'>, 'children' | 'viewBox'> & {
  /** `disc` is the standalone badge; `bare` sits on an existing surface. */
  variant?: 'disc' | 'bare';
  /**
   * Accessible name. Omit it where the mark sits next to the wordmark, which
   * already names the site — a second announcement is noise.
   */
  title?: string;
};

/**
 * The mark.
 *
 * Inline SVG rather than an `<img>`: the `bare` variant inherits the
 * surrounding text colour, and the header needs no extra request on the
 * critical path of every page.
 */
export function MaquaMark({ variant = 'disc', title, className, ...props }: MaquaMarkProps) {
  const decorative = !title;

  return (
    <svg
      viewBox="0 0 100 100"
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      className={cn('shrink-0', className)}
      {...props}
    >
      {decorative ? null : <title>{title}</title>}

      {variant === 'disc' ? <circle cx="50" cy="50" r="48" fill={BRAND_COLOURS.deep} /> : null}

      <g
        fill="none"
        stroke={variant === 'disc' ? BRAND_COLOURS.seaglassLight : BRAND_COLOURS.seaglassDark}
        strokeWidth="5"
        strokeLinecap="round"
      >
        <path d={ARC_UPPER} />
        <path d={ARC_LOWER} />
      </g>

      {/* `currentColor` on the bare variant, so one asset works on light and
          dark surfaces without a second file to keep in step. */}
      <g fill={variant === 'disc' ? BRAND_COLOURS.limestone : 'currentColor'}>
        <polygon points={GOZO_POINTS} />
        <polygon points={COMINO_POINTS} />
        <polygon points={MALTA_POINTS} />
      </g>
    </svg>
  );
}

/**
 * "maqua.app", with the QUA of "Air QUAlity" carried in a heavier weight.
 *
 * HTML rather than SVG text: it inherits the page font, scales with the reader's
 * text-size preference, and stays selectable. The emphasis is purely visual, so
 * the segments are joined with no separator and the whole string reads as one
 * word to a screen reader.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    /* Set in the display face: the wordmark is the one place the heading voice
       appears at text size, which is what separates a brand from a label. */
    <span className={cn('font-display font-semibold tracking-tight', className)}>
      <span>ma</span>
      <span className="text-accent font-bold">qua</span>
      <span className="text-muted-foreground font-normal">.app</span>
    </span>
  );
}
