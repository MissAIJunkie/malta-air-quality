# European Air Quality Index — methodology

**Verified:** 2026-07-26 · **Implementation:** `src/config/thresholds.ts`, `src/lib/air-quality/calculate-index.ts` · **Tests:** `src/lib/air-quality/__tests__/calculate-index.test.ts`

This document explains exactly how maqua.app turns a concentration in µg/m³ into a
category and a colour, what that category does and does not mean, and how far the
verification behind it actually extends.

The index is a **communication device**. It is not a compliance instrument, it is
not a health diagnosis, and it is not the same thing as an EU limit value. §6
separates the three deliberately, because conflating them is the most common way
air-quality reporting goes wrong.

---

## 1. The six categories

The European Air Quality Index, as published by the European Environment Agency
(EEA), has six categories. maqua.app uses the EEA's own names and colours
(`src/config/thresholds.ts` → `CATEGORY_PRESENTATION`).

| Band id | Category       | Colour    | Non-colour encoding | Elevated warning |
| ------- | -------------- | --------- | ------------------- | ---------------- |
| 1       | Good           | `#50f0e6` | none                | No               |
| 2       | Fair           | `#50ccaa` | none                | No               |
| 3       | Moderate       | `#f0e641` | dots                | No               |
| 4       | Poor           | `#ff5050` | diagonal            | **Yes**          |
| 5       | Very poor      | `#960032` | dense               | **Yes**          |
| 6       | Extremely poor | `#7d2181` | solid ring          | **Yes**          |

**Band 0 is not a category.** In the upstream payload an `aqi_*` field of `0`
means _no index available_, and `categoryFromSubIndex()` returns `null` for
anything below `1`. maqua.app renders that as "No data" using
`NO_DATA_PRESENTATION` — grey, a grid pattern, a question-mark icon. It is never
shown as Good.

Colour is never the sole carrier of meaning. Every category is presented with a
colour **and** a text label **and** an icon **and** a redundant fill pattern, per
WCAG 2.2 and the project's own rules.

---

## 2. Pollutants, units and averaging periods

| Pollutant | Display | Unit  | Averaging period |
| --------- | ------- | ----- | ---------------- |
| PM2.5     | PM2.5   | µg/m³ | Hourly           |
| PM10      | PM10    | µg/m³ | Hourly           |
| NO2       | NO₂     | µg/m³ | Hourly           |
| O3        | O₃      | µg/m³ | Hourly           |
| SO2       | SO₂     | µg/m³ | Hourly           |

All five averaging periods are **hourly**, which surprises readers who know the
European AQI as a running-mean index. The reason is in the endpoint path:
maqua.app consumes the EEA's `AQI-noRunningMeans/` dissemination layer
(`docs/DATA_SOURCE.md` §3). That variant indexes each hour's concentration
directly rather than a 24-hour running mean for particulates and an 8-hour
running mean for ozone. The averaging period is therefore recorded per pollutant
in `POLLUTANTS` and per threshold set in `AQI_BREAKPOINTS`, and surfaced on every
`PollutantReading` as `averagingPeriod` — so the UI can state it rather than
leaving the reader to assume.

---

## 3. Breakpoint table

Bands are **inclusive integer ranges in whole µg/m³**. The lower bound of each
band is one unit above the previous band's ceiling. These are generated from the
per-pollutant ceiling arrays by `bands()` in `src/config/thresholds.ts`; the
table below is that function's output, written out.

### PM2.5

| Band | Category       | Range (µg/m³) |
| ---- | -------------- | ------------- |
| 1    | Good           | 1 – 5         |
| 2    | Fair           | 6 – 15        |
| 3    | Moderate       | 16 – 50       |
| 4    | Poor           | 51 – 90       |
| 5    | Very poor      | 91 – 140      |
| 6    | Extremely poor | 141 – 800     |

### PM10

| Band | Category       | Range (µg/m³) |
| ---- | -------------- | ------------- |
| 1    | Good           | 1 – 15        |
| 2    | Fair           | 16 – 45       |
| 3    | Moderate       | 46 – 120      |
| 4    | Poor           | 121 – 195     |
| 5    | Very poor      | 196 – 270     |
| 6    | Extremely poor | 271 – 1200    |

### NO₂

| Band | Category       | Range (µg/m³) |
| ---- | -------------- | ------------- |
| 1    | Good           | 1 – 10        |
| 2    | Fair           | 11 – 25       |
| 3    | Moderate       | 26 – 60       |
| 4    | Poor           | 61 – 100      |
| 5    | Very poor      | 101 – 150     |
| 6    | Extremely poor | 151 – 1000    |

### O₃

| Band | Category       | Range (µg/m³) |
| ---- | -------------- | ------------- |
| 1    | Good           | 1 – 60        |
| 2    | Fair           | 61 – 100      |
| 3    | Moderate       | 101 – 120     |
| 4    | Poor           | 121 – 160     |
| 5    | Very poor      | 161 – 180     |
| 6    | Extremely poor | 181 – 600     |

### SO₂

| Band | Category       | Range (µg/m³) |
| ---- | -------------- | ------------- |
| 1    | Good           | 1 – 20        |
| 2    | Fair           | 21 – 40       |
| 3    | Moderate       | 41 – 125      |
| 4    | Poor           | 126 – 190     |
| 5    | Very poor      | 191 – 275     |
| 6    | Extremely poor | 276 – 1000    |

**On band 1 starting at 1 rather than 0.** The EEA publishes the first band as
"0–15" (PM10) and similar. The table above starts band 1 at `1` because the
fractional part of the sub-index is computed from the band's span, and a span
anchored at 1 reproduces the upstream's continuous values exactly. The two are
reconciled by the `max(0, …)` clamp in step 3 of §4: a concentration that rounds
to `0` yields a negative raw fraction, is clamped to `0`, and lands at exactly
`1.0` — the bottom of Good. **0 µg/m³ is a measurement of very clean air, and it
is Good, not "no data".**

---

## 4. The algorithm

Implemented in `calculateSubIndex()`. Deterministic and pure: no AI, no network,
no clock.

```
1. Round the concentration to the nearest whole µg/m³.
      rounded = Math.round(value)

2. Select the band whose INCLUSIVE INTEGER range contains `rounded`.

3. subIndex = bandId + min(0.99, max(0, (rounded − lo) / (hi − lo)))

4. category  = AIR_QUALITY_CATEGORIES[Math.floor(subIndex) − 1]
   (equivalently: BAND_ID_TO_CATEGORY[Math.floor(subIndex)])
```

Four details are load-bearing. Each one was established from the data, not
assumed, and each has a named test.

**The rounding in step 1 decides the category.** For any value within half a unit
of a boundary, the rounding _is_ the classification. PM10 at 15.48 µg/m³ is
**Good** — it rounds to 15. At 15.5 µg/m³ it is **Fair**. An earlier
implementation modelled the bands as half-open real intervals `[15, 45)`, which
called both of those Fair. It reproduced most of the observed data and was
nonetheless wrong; the exhaustive check exposed it (§7).

**The 0.99 cap in step 3.** A concentration sitting exactly on a band ceiling
produces a raw fraction of `1.0`, which would floor into the _next_ band and
report the wrong category. `SUB_INDEX_FRACTION_CAP = 0.99` keeps
`Math.floor(subIndex)` inside the band the value belongs to. This is why the
upstream reports values such as `1.99` and `2.99`, and why PM10 at 45 µg/m³ has a
sub-index of exactly `2.99` and remains Fair.

**Above the top ceiling, the index saturates.** A concentration above band 6's
ceiling returns `6 + 0.99`, not an extrapolation off the published scale. PM10 at
5,000 µg/m³ is Extremely poor with a sub-index of `6.99`.

**Missing is never zero.** `calculateSubIndex()` returns `null` — never `0`, never
a category — for `null`, `undefined`, `NaN`, `Infinity`, and for any value that
rounds to a negative whole number. `buildPollutantReading()` then carries
`value: null`, `category: null`, `subIndex: null`, and the UI renders
"Not available". Two adjacent cases are handled differently on purpose:

| Input                                     | Result                | Why                                                                                                                  |
| ----------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `null` / `undefined` / `NaN` / `Infinity` | `null`                | Not measured, or not a number.                                                                                       |
| `-0.02228` (real SO₂ at Għarb)            | **Good**, sub-index 1 | Analysers report small negatives below the detection limit. Rounded, this is 0 — a genuine measurement of clean air. |
| `-1.2`                                    | `null`                | Rounds to −1. That is an instrument fault, not a measurement, and is rejected rather than flattered into Good.       |
| `0` exactly                               | **Good**, sub-index 1 | A real zero is a real measurement.                                                                                   |

---

## 5. Aggregation

### Station level — the worst reported pollutant wins

`calculateOverall()` takes the station's pollutant readings and returns the worst
one as the station's headline category, with that pollutant recorded as
`dominantPollutant`.

- Pollutants with no value are **skipped entirely**. They neither improve nor
  worsen the result. A station that reports only NO₂ is rated on NO₂.
- If nothing is reportable, the result is `null` throughout and the station is
  shown as "No data" — never as a category.
- Ties within the same category are broken by the higher continuous sub-index,
  then by a stable pollutant ordering, so the dominant pollutant does not flicker
  between equals between refreshes.

The upstream supplies its own `culprit` field. maqua.app recomputes the dominant
pollutant independently and treats `culprit` as a cross-check, for the same
reason it recomputes the index itself (`docs/DATA_SOURCE.md` §5.2).

### Island level — the worst reporting station wins

`summariseMalta()` applies the same principle one level up: the Malta-wide
headline is the worst _reporting_ station, with the same sub-index tie-break. A
mean or median would let one poor station disappear behind four good ones, which
is the wrong failure mode for a health-relevant signal.

The method is returned to the client as `MaltaSummary.aggregation`
(`'worst-station'`), together with `drivingStationId`, `reportingStations`,
`totalStations` and `staleStations`, so the UI states its own methodology instead
of presenting an unexplained headline.

### Only measured values drive the headline

In `EeaAirQualityProvider.getLatestReadings()` the current hour's pollutants are
filtered to `modelled === false` before `calculateOverall()` runs. A modelled
gap-fill inside the current hour therefore cannot become the station's headline
category. See `docs/FORECAST_METHODOLOGY.md`.

---

## 6. Three different kinds of number

`src/config/thresholds.ts` holds three tables that are deliberately never mixed.
They answer different questions and have different legal force.

### (a) AQI categories — communication

`AQI_BREAKPOINTS`. Hourly, per pollutant, six bands. They exist to answer _"is
the air unusually bad right now, and should I change what I am doing?"_ They have
**no legal status**. Being in "Poor" is not an offence and does not mean any limit
has been breached.

### (b) EU limit values — legal compliance

`EU_LIMIT_VALUES`. In force under **Directive 2008/50/EC**, transposed in Malta by
**S.L. 549.59**. These answer _"is the Member State in compliance?"_ — a question
about statistics over a whole calendar year, assessed by the competent authority
(ERA), not by this website.

| Pollutant | Value     | Averaging period      | Permitted exceedances/year | Reference                         | Assessable from one hour? |
| --------- | --------- | --------------------- | -------------------------- | --------------------------------- | ------------------------- |
| PM10      | 50 µg/m³  | 24 hours              | 35                         | Annex XI                          | No                        |
| PM10      | 40 µg/m³  | Calendar year         | —                          | Annex XI                          | No                        |
| PM2.5     | 25 µg/m³  | Calendar year         | —                          | Annex XIV                         | No                        |
| NO₂       | 200 µg/m³ | 1 hour                | 18                         | Annex XI                          | No                        |
| NO₂       | 40 µg/m³  | Calendar year         | —                          | Annex XI                          | No                        |
| SO₂       | 350 µg/m³ | 1 hour                | 24                         | Annex XI                          | No                        |
| SO₂       | 125 µg/m³ | 24 hours              | 3                          | Annex XI                          | No                        |
| O₃        | 120 µg/m³ | Max daily 8-hour mean | 25                         | Annex VII (target value)          | No                        |
| O₃        | 180 µg/m³ | 1 hour                | 0                          | Annex XII (information threshold) | **Yes**                   |
| O₃        | 240 µg/m³ | 1 hour                | 0                          | Annex XII (alert threshold)       | **Yes**                   |

**Directive (EU) 2024/2881** tightens several of these from 1 January 2030. It is
not yet in application and is therefore not used for current comparisons.

### (c) WHO 2021 global air quality guidelines — health guidance, not law

`WHO_GUIDELINES`. Health-based recommendations. They are **not** legally binding
anywhere in the EU and are generally stricter than the Directive.

| Pollutant | Value     | Averaging period    |
| --------- | --------- | ------------------- |
| PM2.5     | 15 µg/m³  | 24 hours            |
| PM2.5     | 5 µg/m³   | Annual              |
| PM10      | 45 µg/m³  | 24 hours            |
| PM10      | 15 µg/m³  | Annual              |
| NO₂       | 25 µg/m³  | 24 hours            |
| NO₂       | 10 µg/m³  | Annual              |
| O₃        | 100 µg/m³ | Peak season, 8-hour |
| SO₂       | 40 µg/m³  | 24 hours            |

### Why one hourly reading cannot establish an annual exceedance

Two independent reasons, both encoded in the data rather than left to the
copywriter:

1. **Averaging-period mismatch.** An annual limit is a statistic over 8,760
   hours. A single hour is one sample of that statistic. A single hour above
   40 µg/m³ of NO₂ tells you nothing about whether the annual mean will exceed
   40 µg/m³ — it is entirely normal for an urban station to sit above the annual
   limit for part of a day and comfortably below it across the year.
2. **Permitted exceedances.** Several genuinely hourly and daily limits allow a
   fixed number of exceedances per calendar year — 18 for the NO₂ hourly limit,
   35 for the PM10 daily limit, 24 for the SO₂ hourly limit. A single exceedance
   is therefore not a breach even when the averaging period matches.

`compareToThresholds()` encodes this as the `conclusive` flag, derived from
`assessableFromSingleReading` on each entry. It deliberately **returns facts, not
a verdict**: pollutant, value, threshold, averaging period, reference, whether
the value is numerically `above`, and whether that is `conclusive`. The caller
must phrase a non-conclusive comparison as an observation about one hour —
"above the level of the annual limit value" — and never as a legal exceedance.

`findConclusiveExceedances()` returns only those comparisons that are both
`above` and `conclusive`. In practice that is currently just the two ozone
thresholds, which are genuine single-hour public-information triggers under Annex
XII.

---

## 7. Verification, and its exact scope

Two separate claims. Both matter; they are not the same claim.

### Discovery-time verification

Per `docs/DATA_SOURCE.md` §5.2: the algorithm in §4 reproduced the upstream
sub-index for **all 6,760 observed (concentration, sub-index) pairs** drawn from
the five Malta stations, across all five pollutants, with **0 mismatches**.
Verified **2026-07-26**. That full capture is not committed to the repository.

A continuous least-squares regression was attempted first, recovered approximately
the right band edges but the wrong classification rule, and is **not** the basis
for these numbers. It is recorded so that a superseded method is not mistaken for
corroboration.

### Continuous CI verification

The committed oracle, `fixtures/upstream-aqi-oracle.json`, is a **615-pair
subset** of that capture and runs on every CI execution
(`calculate-index.test.ts`). Its composition:

| Pollutant | Pairs |
| --------- | ----- |
| PM10      | 138   |
| NO₂       | 137   |
| PM2.5     | 137   |
| O₃        | 113   |
| SO₂       | 90    |

| Band reached | Pairs |
| ------------ | ----- |
| 1 (Good)     | 170   |
| 2 (Fair)     | 238   |
| 3 (Moderate) | 192   |
| 4 (Poor)     | 15    |
| 5–6          | 0     |

So CI re-verifies a **subset** of the original claim, not the whole of it: every
pollutant is covered, but only bands 1–4 are exercised by real observations in
the committed fixture. Bands 5 and 6 are covered in CI by explicit boundary
assertions against the table, not by upstream agreement.

### The top-band ceilings are not observation-confirmed

The ceilings of band 6 — **PM2.5 800, PM10 1200, NO₂ 1000, SO₂ 1000 µg/m³** —
have **no supporting observations**. Malta has not recorded concentrations
anywhere near them. Only O₃'s **600** was fitted at all, from three points.

This is harmless, and the reason is structural rather than a matter of judgement:
anything at or above band 6's _floor_ is "Extremely poor" regardless of where the
ceiling sits, and above the ceiling `calculateSubIndex()` saturates at
`bandId + 0.99` rather than extrapolating. **The unconfirmed ceilings move only
the fractional part within "Extremely poor". They can never change the
category.**

**In the discovery-time capture** (the 6,760-pair run above, not the committed
615-pair CI subset), the band ceilings for bands 1–5 — the boundaries that
actually decide which of the six categories is shown — were confirmed by
observation for every pollutant.

### What could not be verified

**ERA's own presentation.** `era.org.mt` returns HTTP 403 behind Cloudflare bot
protection to every non-browser client, including static assets
(`docs/DATA_SOURCE.md` §2). It was therefore impossible to check whether ERA
presents these measurements using the same index, the same category names, or the
same colours. The **EEA methodology is the documented default** for that reason,
and it is labelled as the EEA's throughout the interface. If ERA's presentation
differs, ERA is the authoritative source and maqua.app's categories should be
read as "the European AQI applied to ERA's measurements", which is exactly what
they are.

---

## 8. Sources

| What                                                                         | Where                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| European Air Quality Index (methodology, categories, colours, health advice) | <https://airindex.eea.europa.eu/AQI/index.html>                                       |
| Dissemination layer consumed by maqua.app                                    | `https://dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans/` |
| Directive 2008/50/EC (ambient air quality)                                   | <https://eur-lex.europa.eu/eli/dir/2008/50/oj>                                        |
| Directive (EU) 2024/2881 (recast, applies from 2030)                         | <https://eur-lex.europa.eu/eli/dir/2024/2881/oj>                                      |
| WHO global air quality guidelines, 2021                                      | <https://www.who.int/publications/i/item/9789240034228>                               |
| Malta's Environment and Resources Authority                                  | <https://era.org.mt/>                                                                 |

**Attribution**, rendered verbatim wherever data is shown:

> Air-quality data provided by Malta's Environment and Resources Authority (ERA),
> disseminated via the European Environment Agency (EEA). maqua.app is an
> independent project and is not operated by, affiliated with, or endorsed by ERA
> or the EEA.

**Health guidance disclaimer**, carried with every piece of health advice:

> maqua.app provides general environmental information and does not replace
> medical advice or official emergency guidance.
