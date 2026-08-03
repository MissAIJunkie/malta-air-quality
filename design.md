# Design — maqua.app

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

Vibe: **civic instrument, Mediterranean cool, precise.** The subject is public
health information, so the chrome stays quiet and the six EEA air-quality band
colours stay the loudest thing on any page.

## Genre

modern-minimal

## Macrostructure family

- App pages (`/`, `/station/[stationId]`, `/alerts`): **Workbench** — the map,
  the readings and the forms are the content; headings are functional, sections
  separate by gap and surface, no marketing structure.
- Content pages (`/about`, `/methodology`, `/privacy`): **Long Document** —
  single column, 65–70 ch measure, generous leading, real heading outline.

## Theme

Semantic tokens live in `src/app/globals.css` and are re-pointed by the `.dark`
class (next-themes, class strategy — no `prefers-color-scheme` rule; see the
rationale comment in that file). The light/dark/system switcher is a permanent
feature.

Anchor hue: cobalt (~262°). Blue is the one hue the European AQI scale does not
use, so a blue control can never be misread as a band. Do not move the accent
off blue without re-litigating that constraint.

| Token             | Light                                   | Dark                               |
| ----------------- | --------------------------------------- | ---------------------------------- |
| `--background`    | `#f6f7f9` (cool near-white)             | `#0b1015` (near-black)             |
| `--foreground`    | `#0f151b`                               | `#e8edf2`                          |
| `--primary`       | `oklch(46% 0.185 262)` cobalt           | `oklch(78% 0.11 255)` light cobalt |
| `--primary-hover` | `oklch(40% 0.17 262)`                   | `oklch(84% 0.09 255)`              |
| `--ring`          | `oklch(50% 0.19 262)`                   | `oklch(74% 0.13 255)`              |
| `--accent`        | `#115c46` seaglass (success/brand only) | `#6fd3ac`                          |

**Reserved:** the `--color-aq-*` band colours are the EEA's published index
colours. Identical in light and dark, never theme-inverted, never borrowed for
buttons, links or form states. Colour never travels alone — each band also
carries its texture class.

## Typography

- Display: **Space Grotesk**, weight 600–700, style normal, `latin-ext`
  (Maltese ħ ġ ż ċ must not fall back mid-word). Headings only, never body.
- Body: **Public Sans**, weight 400, `latin-ext`. Commissioned for
  public-information text; carries all prose.
- Mono (outlier): **IBM Plex Mono**, weights 400/500/600. Figures, timestamps,
  small uppercase labels — two roles, no more.
- Display tracking: −0.02 em (−0.01 em below ~20 px).
- All faces self-hosted via `next/font`, `display: 'swap'`. No italic headers.

## Spacing

Tailwind v4 default 4-pt scale. `--size-tap: 2.75rem` is the minimum pointer
target for every interactive element (stricter than WCAG 2.2 AA). Pages use
utility classes; never raw pixel values.

## Shape & elevation

- `--radius-card: 0.625rem` (controls, small surfaces) · `--radius-panel: 0.875rem`
  (cards, panels). Buttons and tabs are **pill-shaped** (`rounded-full`) — the
  one soft note against the tight-radius surfaces.
- Borders are hairline (`--border`), visible in both themes. Shadows are tight
  and low (`--shadow-card`, `--shadow-panel`); on dark surfaces elevation comes
  from surface lightness, not glow.

## Motion

- Durations 120–180 ms, `ease-out` in / `ease-in` out, defined once as
  `--animate-*` tokens in `globals.css`. Animate `translate`/`scale`/`opacity`
  only.
- Reveal pattern: none. Pages are just there.
- Reduced-motion: global collapse to 0.01 ms (events still fire for Radix).
- Focus rings appear instantly; never animated.

## Microinteractions stance

- Silent success; toasts/status only for failures and async effects.
- No hover-only affordances; every hover state has a focus/touch equivalent.
- `transition-colors` (named properties), never `transition-all`.

## CTA voice

- Primary CTA: pill, `--primary` fill, white/near-black foreground, short verb
  labels, never wraps.
- Secondary: pill, hairline border on `--surface`.
- Links in prose: `--primary`, underline `decoration-from-font`, offset 4.

## Alert voice

The elevated-band warning has two registers, both `DangerBanner`:

- **Strip** (`variant="compact"`): place, band, leading pollutant, time,
  provenance badges, and one link to the page's guidance section. Used where
  every omitted fact (advice, sensitive groups, disclaimers) already appears on
  the same page — the home hero. The strip carries no advice, so the medical
  disclaimer travels with the guidance it links to, not with the strip.
- **Dossier** (default): the full warning with advice, groups, provenance and
  both disclaimers. Used on station surfaces (panel, sheet, station page),
  which are the detail views.

Never render two dossiers in one viewport; the second surface takes the strip
or is dropped.

## Scrollbars

Thin (`scrollbar-width: thin`), thumb from `--border-strong`, transparent
track — styled once in `globals.css`. Scrollbars are never hidden; instead,
layouts avoid being scroll containers at widths where the content fits (the
station row is a snap scroller below `md` and a wrap grid above it). Root keeps
`scrollbar-gutter: stable`.

## Per-page allowances

- App pages: no enrichment — the map, the band rail and the charts are the
  imagery. Never re-draw browser/phone chrome around screenshots.
- Content pages: typography only. Inline images sized to measure, if ever.
- No invented metrics anywhere: every number on these pages is a measurement
  with a stated source and timestamp, or it does not appear.

## What pages MUST share

- The mark + wordmark (wordmark set in the display face; "qua" carries accent
  weight — geometry in `src/components/layout/brand.tsx`, byte-identical to
  `public/icon.svg`).
- The cobalt accent and its footprint (controls and links only, ≤ 5 % of any
  viewport).
- The three faces and their roles; the heading weight (700) and tracking.
- The pill button/tab voice, hairline borders, tight shadows.
- The header (three-section app bar with live status island) and the colophon
  footer with the verbatim ERA/EEA attribution and medical disclaimer.
- The accessibility floor: skip link, `:focus-visible` ring, 44 px targets,
  forced-colours and print rules, `latin-ext`.

## What pages MAY differ on

- Macrostructure within the family (a station page arranges Workbench panels
  differently from the home dashboard).
- Density: app pages run denser; content pages run at reading rhythm.

## Exports

### tokens.css

```css
:root {
  --background: #f6f7f9;
  --foreground: #0f151b;
  --surface: #ffffff;
  --surface-sunken: #edf0f3;
  --muted-foreground: #525c69;
  --border: #dde2e8;
  --primary: oklch(46% 0.185 262);
  --primary-hover: oklch(40% 0.17 262);
  --primary-foreground: #ffffff;
  --ring: oklch(50% 0.19 262);
  --accent: #115c46;

  --font-display: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
  --font-body: 'Public Sans', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;

  --radius-card: 0.625rem;
  --radius-panel: 0.875rem;
  --size-tap: 2.75rem;
}

.dark {
  --background: #0b1015;
  --foreground: #e8edf2;
  --surface: #141c24;
  --surface-sunken: #070b0f;
  --muted-foreground: #a3b1bf;
  --border: #28333d;
  --primary: oklch(78% 0.11 255);
  --primary-hover: oklch(84% 0.09 255);
  --primary-foreground: #0b1015;
  --ring: oklch(74% 0.13 255);
  --accent: #6fd3ac;
}
```

The full token set (band colours, textures, motion, shadows) lives in
`src/app/globals.css`, which is the source of truth; this export is the
portable subset.
