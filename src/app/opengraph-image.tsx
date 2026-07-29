import { ImageResponse } from 'next/og';

import { maquaMarkSvg } from '@/components/layout/brand';
import { AIR_QUALITY_CATEGORIES, CATEGORY_PRESENTATION } from '@/config/thresholds';

/**
 * The mark, as a data URI.
 *
 * Satori — the renderer behind `ImageResponse` — has only partial support for
 * inline SVG children: it silently dropped the `transform` attributes and one of
 * the two arcs, producing a mark that did not match the favicon. A base64 `data:`
 * URI is decoded and rasterised faithfully, so the shared markup is embedded
 * that way instead.
 */
const MARK_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(maquaMarkSvg()).toString('base64')}`;

export const alt =
  'maqua.app — air quality for Malta and Gozo, from the five official monitoring stations';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Social preview card.
 *
 * Static on purpose: it must NOT render a live reading. A share card is cached
 * for days by the platforms that fetch it, so a band shown here would still be
 * telling people the air was Good long after it stopped being true — exactly
 * the "never describe stale data as live" rule this project is built around.
 *
 * What it does show is the six-band scale, which is fixed reference information
 * and cannot go out of date.
 *
 * Drawn with plain layout primitives rather than with the application's own
 * components: Satori, which renders this, supports a small subset of CSS and
 * does not run the full React DOM, so nothing here can rely on Tailwind, on the
 * theme tokens, or on a component that does.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        /* The dark theme's own neutrals, not the old navy. Same reasoning as
           globals.css: the six band colours below are fixed and unadjustable,
           and a deep neutral is what lets all six keep their chroma. */
        background: 'linear-gradient(135deg, #0b1015 0%, #141c24 60%, #1c262f 100%)',
        color: '#e8edf2',
        padding: '72px 80px',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        {/* A bare <img>: next/image has no meaning inside an ImageResponse,
              which rasterises this tree once on the server. */}
        <img src={MARK_DATA_URI} width={96} height={96} alt="" />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Satori requires an explicit display on any element with more
                than one child, so the wordmark's three weights are laid out as
                a flex row rather than as inline spans. */}
          <div style={{ display: 'flex', fontSize: 60, fontWeight: 700, letterSpacing: '-0.02em' }}>
            <span>ma</span>
            <span style={{ color: '#71ceb6' }}>qua</span>
            <span style={{ color: '#9cc8f0', fontWeight: 400 }}>.app</span>
          </div>
          <div style={{ fontSize: 26, color: '#9cc8f0' }}>Malta Air Quality Map</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ fontSize: 46, lineHeight: 1.2, maxWidth: 900, fontWeight: 600 }}>
          What is in the air over Malta and Gozo, hour by hour
        </div>
        <div style={{ fontSize: 26, color: '#a3b1bf', maxWidth: 880, lineHeight: 1.4 }}>
          Readings from all five official monitoring stations, on the European Air Quality Index.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* The band rail, drawn as one continuous axis rather than six
            separate chips — the same figure the site is built around, so a
            shared link and the page it opens read as the same object. No
            pointer: a share card is cached for days and must not appear to
            report a reading. */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden' }}>
          {AIR_QUALITY_CATEGORIES.map((category) => {
            const band = CATEGORY_PRESENTATION[category];
            return (
              <div
                key={category}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  height: 54,
                  background: band.color,
                  color: band.onColor,
                  fontSize: 20,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {category}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 18, color: '#8b99a8' }}>
          Data from Malta&apos;s Environment and Resources Authority (ERA), disseminated via the
          European Environment Agency (EEA). An independent project.
        </div>
      </div>
    </div>,
    size,
  );
}
