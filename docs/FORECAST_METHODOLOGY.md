# Forecast methodology

**Written:** 2026-07-26 · Implementation: `src/lib/air-quality/freshness.ts`,
`src/lib/air-quality/providers/eea-provider.ts`

---

## 1. Where the forecast comes from

maqua.app does not compute a forecast. It does not fit a model, extrapolate a
trend, or ask a language model for a number.

The forecast values are **already present in the payload maqua.app fetches for
the current readings**. Each `current/<CODE>.json` from the EEA dissemination
layer carries roughly ten days of history _and_ roughly 48 hours of forward
values, in one object keyed by ISO hour. Those forward values are CAMS output —
the Copernicus Atmosphere Monitoring Service's European air-quality forecast,
which is the operational forecast the EEA's own public index viewer displays.

Two consequences follow directly, and both are load-bearing:

- **No extra request is made, and no new upstream is introduced.**
  `src/lib/forecast/providers/eea-cams-provider.ts` does exactly one thing: split
  the series that `air-quality/service.ts` already fetched into observations and
  forecast, honestly. It caches the split under `cacheKeys.forecast(stationId)`
  with `cachePolicy.forecast`, and keeps `OBSERVED_TAIL_HOURS = 24` of
  observations alongside it so trend drivers can compare the outlook with what
  has just happened.
- **maqua.app cannot improve on it, and does not try.** Whatever CAMS says is
  what is shown, relabelled and re-categorised through the same deterministic
  index as the observations (`docs/AQI_METHODOLOGY.md`) so that a forecast hour
  and an observed hour are directly comparable on the same scale.

---

## 2. Where this sits in the hierarchy of forecast provenance

The project's rule is that a forecast should come from the most authoritative
available source, and that the tier it came from must be stated rather than
implied.

**maqua.app sits at tier 2: it republishes an official European environmental
forecast.**

| Tier  | What it is                                                                                 | maqua.app                                                                                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | The national competent authority's own published air-quality forecast for Malta            | **Unavailable.** ERA is the authority, but `era.org.mt` returns HTTP 403 behind Cloudflare to every non-browser client, so nothing published there could be retrieved or even inspected (`docs/DATA_SOURCE.md` §2). No such feed was ever observed. |
| **2** | An official European environmental forecast — CAMS, disseminated by the EEA                | **This is what maqua.app uses.**                                                                                                                                                                                                                    |
| **3** | A statistical or machine-learned forecast fitted by maqua.app from historical station data | **Not done.** Five stations and a ten-day upstream window are not a basis for a forecast that would beat CAMS, and publishing a home-made forecast beside an official one invites the reader to treat them as equivalent.                           |
| **4** | Numbers produced by a language model                                                       | **Forbidden outright** (`docs/AI_USAGE.md` §3). A model may describe a forecast that already exists. It may never produce, adjust or extrapolate a value.                                                                                           |

Tier 1 would be preferred. Tier 2 is what is actually reachable, and the
interface says so.

---

## 3. Identifying a forecast — why the clock cannot do it

The obvious implementation is `timestamp > now`. It is wrong, and it fails in a
way that would silently present modelled values as measurements.

Two facts about the upstream make it wrong:

1. **The newest key in the payload is in the future.** Measured on 2026-07-26,
   the newest key sat about 51 hours ahead of the wall clock. A naive "take the
   last key" implementation would show a two-day-old-in-reverse CAMS forecast as
   the live reading. Worse, `classifyFreshness()` treats future timestamps as
   `fresh` — deliberately, because forecast points are legitimately ahead of now —
   so the mistake would not even look stale.
2. **`modelled_* === 1` also appears on past hours.** The upstream gap-fills
   missing measurements with modelled values. A point eleven days old can be an
   estimate. So the flag alone does not mean "forecast" either.

The reliable discriminator uses both, in this order:

```ts
// 1. The newest hour carrying at least one genuinely measured value
//    (modelled_* === 0). This — never the newest key — is `measuredAt`.
const latestObserved = latestObservedTimestamp(points);

// 2. Anything after that boundary is forecast.
const forecast = isForecastPoint(point.measuredAt, latestObserved);
```

That gives three distinct kinds of point, which the UI must not conflate:

| Kind                | `modelled` | Position           | Label             |
| ------------------- | ---------- | ------------------ | ----------------- |
| **Observation**     | `false`    | ≤ `latestObserved` | Measured          |
| **Gap-filled past** | `true`     | ≤ `latestObserved` | Estimated         |
| **Forecast**        | `true`     | > `latestObserved` | Estimated outlook |

`isForecastPoint()` returns `false` when `latestObservedIso` is `null` — if
nothing was ever measured, no boundary exists and no point can be _proved_ to be a
forecast. Every such point still carries `modelled: true` and is labelled
Estimated, so it fails safe.

---

## 4. What the current implementation actually does

Four behaviours, all in committed code:

**The headline category can never be driven by an estimate.** In
`EeaAirQualityProvider.getLatestReadings()` the current hour's pollutants are
filtered to `modelled === false` before `calculateOverall()` runs:

```ts
const measuredOnly: Partial<Record<PollutantCode, PollutantReading>> = {};
for (const [code, reading] of Object.entries(point.readings)) {
  if (!reading.modelled) measuredOnly[code] = reading;
}
const overall = calculateOverall(measuredOnly);
```

A station whose NO₂ was gap-filled this hour is rated on the pollutants that were
actually measured, and `partial: true` records that something is missing.

**History excludes forecast by default.** `getStationHistory()` drops forecast
points unless `HistoryOptions.includeForecast` is explicitly `true`. Asking for
history returns history.

**Every point carries its own flag.** `HistoricalReading.forecast` and
`PollutantReading.modelled` travel with the data through the API envelope, so a
chart cannot lose the distinction between a solid line and a dashed one.

**The fixture provider preserves the shape.** It rebases a real captured payload
so the newest captured hour becomes two hours ago, leaving genuine forecast hours
ahead — and marks everything after the current hour as `modelled`. Development
and CI exercise the same forecast code paths production does.

The forecast domain model in `src/lib/forecast/types.ts` makes two of these
guarantees structural rather than a matter of discipline:

- **Every forecast point is `estimated: true`.** There is no code path that emits
  one without it.
- **Every point carries a `source` and a `methodology` label**, so a value can
  never be lifted out of context and read as a measurement.
  `CAMS_FORECAST_SOURCE` names _"Copernicus Atmosphere Monitoring Service (CAMS),
  disseminated by the European Environment Agency (EEA)"_.

Forecast **drivers** — the short reasons offered for why the outlook points the
way it does — are derived by rule from the forecast series and from public
weather and aerosol forecasts. Never by a language model, and never as a claim of
causation: `label` and `detail` are hedged by construction.

---

## 5. Confidence

Implemented in `src/lib/forecast/confidence.ts` — pure, clock-injectable, and
free of imports beyond its own types, so it is directly unit-testable.

**Confidence is a band, not a probability.** `ForecastConfidence` is
`'high' | 'medium' | 'low'`. Nobody has verified CAMS skill over Malta against
ERA's stations, so publishing "78 % confident" would imply a calibration this
project has not performed. Three bands, each with a stated reason, are honest
about what is actually known.

### Base band, from lead time

`FORECAST_HORIZONS` follows the shape of chemical-transport-model skill rather
than taste: the first half-day is largely determined by the initial state and by
conditions already in place; skill then falls off through the second day as the
meteorology driving dispersion becomes the dominant uncertainty.

| Lead time                    | Band                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| ≤ 12 h (`highMaxHours`)      | `high`                                                      |
| 12 – 36 h (`mediumMaxHours`) | `medium`                                                    |
| > 36 h                       | `low`                                                       |
| Unknown / unparseable        | **`low`** — an unknown horizon must fail safe, never `high` |

A horizon in the past is treated as immediate: a forecast hour that has already
arrived is as well determined as this method gets.

### Degradations, which accumulate

On top of the horizon, confidence drops one band per condition when the _inputs_
are thin (`assessConfidence`):

| Condition                                                                | Threshold                                                                                                                              |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Few forecast hours published                                             | `< 6` (`MIN_DENSE_FORECAST_HOURS`) — below this the outlook stops being a plan for the day and becomes a note about the next few hours |
| Published series covers only part of the usual outlook                   | `< 0.25` of `EXPECTED_FORECAST_HOURS` (48) (`MIN_HORIZON_COVERAGE`)                                                                    |
| The station is reporting only some of its pollutants                     | `stationPartial`                                                                                                                       |
| Modelled hours cover fewer pollutants than the station normally measures | `< 0.5` (`MIN_POLLUTANT_COVERAGE`)                                                                                                     |

**Degradations stack.** A 40-hour forecast from a partially reporting station
with a two-hour series lands firmly at `low` rather than being rescued by any
single favourable factor. `degradeConfidence()` never goes below `low`, and
`worstConfidence()` takes the least confident of a set — a summary must not
flatter its parts, exactly as `worstFreshness()` does not.

### The reasons travel with the band

`assessConfidence()` returns `{ confidence, reasons, reasonKeys }` — plain
English _and_ matching i18n keys, in the order applied. The band is never shown
without its reasoning, so the reader can see how it was derived rather than
being asked to trust a label. `FORECAST_CONFIDENCE_I18N_KEYS` exports the full
key set so the dictionary can be completed.

Dual emission (English text plus a key) is deliberate: `t()` returns the key
itself when a translation is missing, so a key-only payload would render
`forecast.confidence.reason.shortLead` to any reader whose dictionary has not
caught up.

### Why confidence is computed per request, not cached

`eea-cams-provider.ts` caches **only the split series**, under
`cacheKeys.forecast(stationId)` with `cachePolicy.forecast` (3600 s TTL,
10 800 s stale-while-revalidate). That series is a function of the upstream
payload alone.

Confidence, drivers and lead times all depend on `now`, so they are recomputed
on every request. A 59-minute-old cached "next 12 hours" would be a true
statement about a different 12 hours — which is to say, a lie.

### Rules that continue to hold

1. Confidence is **derived from lead time and input quality**, both from the
   data. Never from a language model, and never from a hand-tuned number that
   looks authoritative.
2. It stays **qualitative**. Should the bands ever become probabilities, that
   requires a verification study against ERA's stations first.
3. It is **stated as a methodology**, the way `MaltaSummary.aggregation` states
   `'worst-station'`.

---

## 6. Labelling rules

The forecast is never presented as an observation. That is not a guideline; it is
one of the project's hard rules, and it is enforced structurally by the `modelled`
and `forecast` flags travelling with every point.

**The heading is "Estimated air-quality outlook".** Not "Forecast", which reads
as a promise; not "Prediction"; not "Air quality tomorrow", which reads as fact.
The word _Estimated_ appears in the heading itself, not only in small print
beneath it.

Required with any forecast display:

- Every forecast point is labelled **Estimated**, in text — not by colour or line
  style alone. Category colours already carry an icon, a text label and a
  redundant pattern (`CATEGORY_PRESENTATION.pattern`); the forecast/observation
  distinction gets the same non-colour treatment.
- The **source is named**: modelled values from the Copernicus Atmosphere
  Monitoring Service (CAMS), disseminated by the EEA.
- The **observation boundary is visible** on any chart that shows both. A reader
  must be able to see where measurement stops and modelling begins, without
  hovering.
- **Lead time is stated** — "in 6 hours", "tomorrow afternoon" — in Europe/Malta
  local time, via `formatInMalta()`.
- **Missing forecast values are missing.** A forecast hour without a value shows
  as unavailable, never as zero and never as a category.
- **No forecast in the headline.** The current-conditions block on the home page
  and each station page shows measured values only (§4). The outlook is a
  separate, clearly-headed section.
- **No alerts from forecast values.** Alerts are triggered by measured
  exceedances. A forecast may inform the copy of an alert already triggered; it
  may never trigger one.
- Health guidance attached to a forecast carries the standard disclaimer:

  > maqua.app provides general environmental information and does not replace
  > medical advice or official emergency guidance.

---

## 7. Limitations

Stated plainly rather than buried, in the manner of `docs/DATA_SOURCE.md` §9.

1. **It is a model, not a measurement.** CAMS is a chemical-transport modelling
   system. Its output for a specific station at a specific hour can be
   substantially wrong, particularly for locally-driven pollutants.
2. **Traffic stations are the hardest case.** Msida and St Paul's Bay are traffic
   stations. NO₂ at a kerbside is dominated by local emissions at a scale a
   regional model does not resolve. Forecast NO₂ at those two stations should be
   read as a regional tendency, not as a kerbside figure.
3. **The horizon is about 48 hours.** The payload has been observed to extend to
   roughly 51 hours ahead of the wall clock, but that is a property of one
   snapshot, not a guarantee. Nothing beyond what the payload actually contains is
   ever displayed, and nothing is extrapolated past its final key.
4. **Saharan dust is a known weak point.** Dust intrusions are a genuinely
   important driver of PM10 in Malta and are among the harder events for
   atmospheric models to place in time and magnitude. A forecast that misses a
   dust event will understate PM10. `docs/CONTEXT_SOURCES.md` §3 covers the
   separate, explicitly-modelled dust context.
5. **Malta is small and coastal.** Sea breezes, island-scale circulation and
   sharp land–sea contrasts all sit near or below the resolution of a regional
   model.
6. **The forecast is refreshed at the upstream's cadence, not on demand.** A
   forecast point does not update until the payload does — hourly, with a ~58
   minute lag.
7. **Revision without notice.** Like the observations, these are near-real-time
   values from an operational system. They may change between refreshes, and a
   forecast hour that later becomes an observed hour may carry a different value
   entirely. That is the system working correctly, and it is why forecast and
   observation are stored and labelled separately rather than merged into one
   series.

---

## 8. Sources

| What                                     | Where                                                             |
| ---------------------------------------- | ----------------------------------------------------------------- |
| Copernicus Atmosphere Monitoring Service | <https://atmosphere.copernicus.eu/>                               |
| CAMS European air quality forecasts      | <https://atmosphere.copernicus.eu/european-air-quality-forecasts> |
| EEA European Air Quality Index viewer    | <https://airindex.eea.europa.eu/AQI/index.html>                   |
| The payload maqua.app reads              | `docs/DATA_SOURCE.md` §3–§5                                       |

> Air-quality data provided by Malta's Environment and Resources Authority (ERA),
> disseminated via the European Environment Agency (EEA). maqua.app is an
> independent project and is not operated by, affiliated with, or endorsed by ERA
> or the EEA.
