# medias

Motion pieces for maqua.app.

| File | Format | Audio | Use |
| --- | --- | --- | --- |
| `maqua-app-reel.mp4` | 1920×1080, 16:9 | yes | Landscape title sequence — presentations, social, anywhere sound plays |
| `maqua-app-reel-silent.mp4` | 1920×1080, 16:9 | — | Site hero / README embeds, where autoplay is muted anyway — **not in git**, see below |
| `maqua-app-reel-vertical.mp4` | 1080×1920, 9:16 | yes | TikTok / Reels / Shorts |
| `maqua-app-reel-vertical-silent.mp4` | 1080×1920, 9:16 | — | Mute variant — **not in git**, see below |

All four are 15.000 s, 60 fps, H.264 (yuv420p, bt709), and cut to the same five
beats from the same engine and the same data. `*-poster.jpg` is the frame at
t=13.7 s for each aspect ratio, for use as a thumbnail.

The soundtrack is `bg_music.mp3`, trimmed to 15.000 s with a 0.45 s fade-out and
encoded to AAC 192 kbps. Its levels are untouched: the source measures −15.7 LUFS
integrated with a −1.3 dBFS true peak, which is already at the streaming target,
so normalising it would have been a change for its own sake. The silent variants
are the same video stream, copied — not re-encoded — so the two match frame for
frame.

| t | beat | what it shows |
| --- | --- | --- |
| 0.0–2.4 | Particulate | A drifting particle field that resolves into the coastline |
| 2.2–5.6 | The network | Malta and Gozo, the five ERA stations, the station list |
| 5.5–8.9 | The reading | Camera push to Msida; a station panel builds, pollutant by pollutant |
| 8.8–12.1 | The scale | The band strip expands into the six-band European AQI scale, then becomes a 48-hour series and a 5-day outlook |
| 12.0–15.0 | Lockup | The dust reassembles into the wordmark |

## The vertical cut is a re-edit, not a crop

Same beats, same timings, different composition — a letterboxed or centre-cropped
16:9 would lose the map, the panel or both.

- Panels **stack** instead of sitting side by side: map above, reading below.
- The six-band scale **stands up**. Good at the bottom, Extremely poor at the
  top, which is what a value axis wants anyway — so beat 4's morph into the
  chart's y-axis is more direct in portrait than it is in landscape.
- The station list is keyed to the map by **numbered badges**. The landscape
  cut's leader lines do not survive a portrait frame.
- The value tag rides the needle instead of sitting beside it, and lands where
  58 µg/m³ actually falls inside the Moderate band.
- Platform chrome is respected: nothing load-bearing sits above y=300, below
  y=1600, or inside the right-hand action rail (x>930 once y>1000). Captions
  and the action rail cover a vertical video's edges on every platform.

## What is real and what is not

Everything structural is taken from the repository, not invented:

- **Station names, codes, coordinates, types, altitudes** — `src/config/stations.ts`, verbatim.
- **Band names, colours and textures** — `src/config/thresholds.ts` and the
  `--color-aq-*` tokens in `src/app/globals.css`. The six EEA index colours are
  used exactly as published, never theme-shifted, and each carries its texture
  class, per `design.md`.
- **PM10 band boundaries** (1–15, 16–45, 46–120, 121–195, 196–270, 271+) —
  `AQI_BREAKPOINTS` in `src/config/thresholds.ts`.
- **Typefaces** — Space Grotesk, Public Sans and IBM Plex Mono, the three faces
  `src/app/layout.tsx` loads. Unsubsetted, so Maltese `ħ ġ ż ċ` render in-face.
- **Coastline** — real geometry, not a drawing. See attribution below.

**The readings are not real.** No live or historical measurement appears. The
concentrations shown for Msida (PM2.5 12, PM10 58, NO₂ 34, SO₂ 9 µg/m³), the
per-station bands in the list, and the history/forecast series are illustrative
values chosen to sit in the bands they are labelled with. Every frame that shows
one carries a caption saying so — `ILLUSTRATIVE VALUES — NOT A LIVE READING`,
`ILLUSTRATIVE BANDS — NOT LIVE READINGS`, `ILLUSTRATIVE SERIES — NOT A LIVE
FORECAST`. Do not crop them out.

### Attribution

The coastlines of Malta, Gozo, Comino, Cominotto, Manoel Island, St Paul's
Islands and Filfla are derived from OpenStreetMap `natural=coastline` ways,
retrieved 2026-09-27 via the Overpass API, stitched into rings and simplified
(Ramer–Douglas–Peucker, ~35 m). **© OpenStreetMap contributors**, licensed
[ODbL](https://opendatacommons.org/licenses/odbl/). The credit is burned into
both end cards; keep it there in any re-cut.

**`bg_music.mp3` has no recorded provenance.** It was added to this directory
without a source, and it is now baked into `maqua-app-reel.mp4` and
`maqua-app-reel-vertical.mp4`. Every other asset here is accounted for — OSM
under ODbL, the fonts from Google Fonts, the app's own data — so this is the one
gap, and it is the one most likely to cause trouble: an uncleared bed is what
gets a posted video muted, claimed or taken down. Fill in the source and licence
below before publishing anywhere public, or swap the track.

> Source: _unknown_ · Licence: _unknown_

The `-silent` variants carry no audio and are unaffected.

## How it was made

Rendered frame by frame from a single deterministic `render(t)` canvas function
— no DOM, no `requestAnimationFrame`, no accumulated state, so any frame can be
reproduced in isolation. Frames are driven through headless Chromium (the
Playwright build already in `devDependencies`) and piped to ffmpeg:

```
-c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p
-color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart
```

### Rebuilding

```bash
cd medias/source
./fetch-fonts.sh              # downloads the three faces into source/fonts (gitignored)
node render.mjs               # 16:9  -> ../maqua-app-reel.mp4,          ~3 min
node render.mjs -v            # 9:16  -> ../maqua-app-reel-vertical.mp4, ~3 min
node stills.mjs 3.6 8.2       # inspect single frames without a full render
node stills.mjs -v 3.6 8.2    # ditto, vertical
```

`render.mjs` writes the silent master. To lay the track back over it:

```bash
ffmpeg -i maqua-app-reel-silent.mp4 -i bg_music.mp3 \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -ar 48000 -ac 2 \
  -af "afade=t=out:st=14.55:d=0.45" -t 15 -movflags +faststart maqua-app-reel.mp4
```

`source/` layout:

| File | |
| --- | --- |
| `core.js` | Shared engine — palette, station and band data, easing, fonts, projection, coastline sampling, particles, grain, and the generic map drawing. Stage size comes from `window.__W/__H`. |
| `reel.js` + `reel.html` | 16:9 scene: layout, timing, beats |
| `reel-vertical.js` + `reel-vertical.html` | 9:16 scene |
| `islands.json` | The simplified OSM-derived coastline — the ODbL attribution travels with this file |
| `logo.json` | Paths lifted from `public/icon.svg` |
| `render.mjs` / `stills.mjs` / `serve.mjs` | Frame driver, single-frame inspector, static server |

A scene supplies `sceneInit()` and `render(t, frameIndex)`; `core.js` does the
rest and calls `window.__boot()`. Adding another aspect ratio means one new
scene file, not a fork.

## What is tracked, and why

Video in git is permanent: every future clone carries it. So only the two cuts
anyone actually distributes are tracked, ~27 MB between them. The `-silent`
variants are excluded by `medias/*-silent.mp4` in the repository `.gitignore` —
they are the same video stream copied with `-c:v copy`, so keeping a second
27 MB of it in history buys nothing. Rebuild either in about three minutes:

```bash
cd medias/source
./fetch-fonts.sh
node render.mjs    ../maqua-app-reel-silent.mp4
node render.mjs -v ../maqua-app-reel-vertical-silent.mp4
```

`render.mjs` always renders silent, and with no argument it writes to the
tracked filename — hence the explicit output paths above, so a rebuild does not
overwrite a cut that carries audio. The mux command earlier in this file lays
the track back over a silent master. `source/fonts/` is untracked too;
`fetch-fonts.sh` re-downloads it.
