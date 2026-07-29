import type { MetadataRoute } from 'next';

import { getDictionary, t } from '@/lib/i18n';

/**
 * Web app manifest.
 *
 * `display: 'standalone'` because the map is the product and browser chrome
 * costs vertical space on a phone. The layout adds `env(safe-area-inset-*)`
 * padding for exactly this mode, where there is no address bar to sit under a
 * notch.
 *
 * Two icon roles are declared. `any` is the circular badge, which is what
 * appears in a browser tab or a task switcher. `maskable` is a separate,
 * full-bleed drawing with the artwork pulled inside the central safe area —
 * Android crops a maskable icon to whatever shape the launcher uses, and
 * feeding it the circular badge would clip the arcs off.
 */
export default function manifest(): MetadataRoute.Manifest {
  const dict = getDictionary();

  return {
    name: 'maqua.app — Malta Air Quality',
    short_name: t(dict, 'app.shortName'),
    description: t(dict, 'app.description'),
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    /* Kept in step with `--background` (light) in globals.css and with
       `viewport.themeColor` in layout.tsx. When these drift, an installed copy
       shows a splash screen in one palette and a title bar in another. */
    background_color: '#f6f7f9',
    theme_color: '#f6f7f9',
    lang: 'en-GB',
    dir: 'ltr',
    categories: ['health', 'weather', 'utilities'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
