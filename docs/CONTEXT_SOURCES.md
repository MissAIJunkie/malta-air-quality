# Environmental context sources

**Written:** 2026-07-26 · Companion to `docs/DATA_SOURCE.md`, which covers the
air-quality measurements themselves.

"Context" means the non-measurement information that helps a reader understand
_why_ the air is as it is: wind, temperature, humidity, precipitation, and
Saharan dust transport. It never changes a category, a value or a threshold — the
index is computed from concentrations alone (`docs/AQI_METHODOLOGY.md`).

---

## Status ledger

Stating this first, because a source table can otherwise read as an
implementation report.

|                                         |                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Implemented**                         | The EEA air-quality dissemination layer (`src/lib/air-quality/providers/eea-provider.ts`); the **Open-Meteo Forecast API** (`providers/open-meteo-provider.ts`); and the **Open-Meteo Air Quality API** for CAMS aerosols (`providers/cams-dust-provider.ts`) — all under `src/lib/environmental-context/`, with `classify-event.ts`, `deduplicate.ts`, `schemas.ts` and `types.ts`. |
| **Probed and blocked**                  | `era.org.mt` — HTTP 403 to every non-browser client.                                                                                                                                                                                                                                                                                                                                 |
| **Allowlisted but deliberately unused** | The EEA Parquet download service.                                                                                                                                                                                                                                                                                                                                                    |
| **Not used at all**                     | Every editorial, news or social source.                                                                                                                                                                                                                                                                                                                                              |

Configuration common to the context layer: `WEATHER_PROVIDER` accepts
`open-meteo` \| `fixture` \| `none` and defaults to `open-meteo`;
`CONTEXT_REFRESH_ENABLED` defaults to `true`; `cacheKeys.weather()` and
`cacheKeys.contextEvents()` have entries in `cachePolicy`.

Anything below marked _from published documentation_ was taken from the
provider's own docs and **not** independently probed from this build
environment. Anything marked _observed_ was measured here on 2026-07-26. The
distinction is the same one `docs/DATA_SOURCE.md` makes, and it is kept for the
same reason.

---

## 1. EEA European AQI dissemination layer — air quality (primary, live)

| Field                               | Value                                                                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                            | EEA European Air Quality Index dissemination layer                                                                                                                                                                              |
| **URL**                             | `https://dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans/`                                                                                                                                           |
| **Ultimate data owner**             | Malta's Environment and Resources Authority (ERA)                                                                                                                                                                               |
| **Data type**                       | Hourly station concentrations (PM2.5, PM10, NO₂, O₃, SO₂) in µg/m³, continuous sub-indices, a `modelled_*` provenance flag per pollutant, and a `culprit` field                                                                 |
| **Observed / forecast / editorial** | **Both.** ~10 days of history plus ~48 h of CAMS forecast in the same payload; `modelled_* === 1` is the only reliable discriminator                                                                                            |
| **Licensing**                       | EEA re-use policy — reuse permitted with acknowledgement of the source                                                                                                                                                          |
| **Refresh frequency**               | Hourly, ~58-minute publication lag (**observed** 2026-07-26)                                                                                                                                                                    |
| **Coverage**                        | 4,593 European stations; **exactly five** in Malta (**observed**)                                                                                                                                                               |
| **Authentication**                  | None                                                                                                                                                                                                                            |
| **Rate limits**                     | None documented. Azure Blob Storage, treated as a courtesy-limited public resource                                                                                                                                              |
| **Reliability**                     | High in observation, but an undocumented endpoint rather than a contractual API. Path structure could change without notice                                                                                                     |
| **Cache policy**                    | `cachePolicy.latestReadings` — 900 s TTL, 7200 s stale-while-revalidate                                                                                                                                                         |
| **Fallback**                        | Zod validation at the boundary; per-station `Promise.allSettled` so one failure does not blank the rest; stale-while-revalidate serves last-known-good with `meta.degradedReason`; **never** an automatic fall back to fixtures |
| **Status**                          | **Implemented and live**                                                                                                                                                                                                        |

Full discovery record, field mapping and response shape: `docs/DATA_SOURCE.md`.

---

## 2. Open-Meteo Forecast API — meteorological context (primary context provider)

| Field                               | Value                                                                                                                                                                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                            | Open-Meteo Forecast API                                                                                                                                                                                                                                                           |
| **URL**                             | `https://api.open-meteo.com/v1/forecast`                                                                                                                                                                                                                                          |
| **Data type**                       | Requested hourly: `temperature_2m`, `relative_humidity_2m`, `dew_point_2m`, `precipitation`, `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `boundary_layer_height`, `surface_pressure`, `cloud_cover`, `temperature_950hPa` (~500 m, used only as an inversion proxy) |
| **Observed / forecast / editorial** | **Forecast/analysis**, from ECMWF and DWD model output. Not station observations. Labelled as modelled context                                                                                                                                                                    |
| **Licensing**                       | **CC BY 4.0** (_from published documentation_). Attribution to Open-Meteo required wherever the data appears. Underlying model data comes from national weather services under their own open terms                                                                               |
| **Refresh frequency**               | Hourly resolution; source models update several times daily (_from published documentation_)                                                                                                                                                                                      |
| **Coverage**                        | Global, ~1–11 km depending on the model. Malta is inside the European high-resolution domain                                                                                                                                                                                      |
| **Authentication**                  | **None.** No API key, no account (_from published documentation_)                                                                                                                                                                                                                 |
| **Rate limits**                     | Free non-commercial tier, with published fair-use guidance in the order of 10,000 calls per day (_from published documentation_; not independently probed). maqua.app's own cache policy keeps it far below any plausible limit                                                   |
| **Reliability**                     | Well-established public service, but a free tier with no availability commitment. Treated as best-effort; an 8-second fetch timeout is applied                                                                                                                                    |
| **Cache policy**                    | `cacheKeys.weather()` with `cachePolicy.weather` — 1800 s TTL, 7200 s stale-while-revalidate. At most two upstream calls an hour regardless of traffic                                                                                                                            |
| **Allowlisted**                     | Yes — `api.open-meteo.com` in `ALLOWED_UPSTREAM_HOSTS`                                                                                                                                                                                                                            |
| **Configuration**                   | `WEATHER_PROVIDER=open-meteo` (default)                                                                                                                                                                                                                                           |
| **Status**                          | **Implemented** — `src/lib/environmental-context/providers/open-meteo-provider.ts`                                                                                                                                                                                                |

### Implementation details that would otherwise look like mistakes

- **One grid point, at `MALTA_CENTRE`.** Malta is 27 km across; five separate
  requests would return near-identical values from the same model cell while
  quintupling the load on a free public service. Weather context is therefore
  island-wide, not per-station, and must be presented that way.
- **`forecast_days=3`.** Three days covers the 48-hour AQI forecast horizon
  (`docs/FORECAST_METHODOLOGY.md`) with slack.
- **`timezone=UTC` throughout.** Conversion to Europe/Malta happens once, in the
  i18n layer.
- **Open-Meteo returns _naive_ timestamps** — `2026-07-26T00:00`, no offset —
  with the offset carried separately in `utc_offset_seconds`. Appending `Z` is
  only correct while that field is `0`, so the provider **asserts** it rather
  than assuming it.
- **The response is parallel arrays.** The Zod schema proves the shape; only an
  explicit length check proves that `wind_speed_10m[7]` really describes
  `time[7]`. Both are applied.

### Fallback behaviour (required)

- On failure, serve last-known-good within the SWR window, labelled with its
  retrieval time.
- Beyond the SWR window, **omit the context panel entirely.** Do not show an
  empty card, and do not substitute a plausible value.
- Context failure must never affect an air-quality reading. The two are fetched
  independently and rendered independently.
- `WEATHER_PROVIDER=none` disables the subsystem outright, and
  `getCapabilities().weather` becomes `false`.
- `WEATHER_PROVIDER=fixture` replays deterministic local data for development and
  CI, and must be as visibly labelled as the fixture air-quality provider.

---

## 3. Open-Meteo Air Quality API — CAMS-derived dust

| Field                               | Value                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                            | Open-Meteo Air Quality API (CAMS aerosols)                                                                                                                                                                                                                                                                 |
| **URL**                             | `https://air-quality-api.open-meteo.com/v1/air-quality`                                                                                                                                                                                                                                                    |
| **Data type**                       | Requested hourly: `dust`, `pm10`, `pm2_5`, `aerosol_optical_depth`, `uv_index`. The primary interest is **dust** (µg/m³) as a proxy for Saharan transport — a recurring and genuinely significant driver of PM10 in Malta, which sits directly on the main corridor between the Sahara and southern Europe |
| **Observed / forecast / editorial** | **Forecast/model output.** CAMS is a modelling system, not a measurement network. Never presented as an observation                                                                                                                                                                                        |
| **Licensing**                       | CC BY 4.0 for the API; underlying data from the Copernicus Atmosphere Monitoring Service (_from published documentation_)                                                                                                                                                                                  |
| **Refresh frequency**               | Hourly resolution; CAMS runs update daily to twice daily (_from published documentation_)                                                                                                                                                                                                                  |
| **Coverage**                        | Requested with `domains=cams_global`. **The European domain omits `dust` entirely** — requesting the default would return the series as absent, which is why the global domain is pinned explicitly                                                                                                        |
| **Authentication**                  | None                                                                                                                                                                                                                                                                                                       |
| **Rate limits**                     | As §2 — same free tier and same fair-use guidance                                                                                                                                                                                                                                                          |
| **Reliability**                     | Best-effort. Dust transport is one of the harder things atmospheric models get right, so the figure is directional rather than precise. 8-second fetch timeout                                                                                                                                             |
| **Cache policy**                    | `cacheKeys.contextEvents()` with `cachePolicy.contextEvents` — 1800 s TTL, 10 800 s stale-while-revalidate                                                                                                                                                                                                 |
| **Allowlisted**                     | Yes — `air-quality-api.open-meteo.com`                                                                                                                                                                                                                                                                     |
| **Status**                          | **Implemented** — `src/lib/environmental-context/providers/cams-dust-provider.ts`                                                                                                                                                                                                                          |

Requested with `forecast_days=3` (matching the meteorological window so the two
series can be read together) and `past_days=1`. Series arriving at an unexpected
length are replaced with nulls and logged as `context.cams_series_misaligned`
rather than being silently misaligned against the time axis.

### Presentation rules

- **Dust is context, never a measurement.** It may explain an elevated PM10
  reading; it may never contribute to one. The station's PM10 category comes from
  the station's PM10 concentration and nothing else.
- **CAMS `pm10` and `pm2_5` are model fields**, kept only as regional background
  context. They are deliberately never mixed with, compared against, or
  substituted for ERA's measured values. Two numbers called "PM10" on one page,
  one measured and one modelled, must be unmistakably distinguished.
- Always labelled as modelled, with CAMS named and the retrieval time shown.
- **Phrased as a possible contributing factor, never as a cause.** This is the
  piece of context most easily abused: _"it was only dust"_ is a real phenomenon
  and also a convenient excuse. The wording stays hedged — _"modelled Saharan
  dust is elevated over the central Mediterranean, which can raise PM10"_ — and
  it never adjusts a measurement.
- **No wildfire-smoke detection is attempted.** Aerosol optical depth alone
  cannot support that claim; see `classify-event.ts`.
- If the dust value is missing, the panel is omitted rather than showing zero.

---

## 4. Environment and Resources Authority (ERA) — blocked

| Field                               | Value                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                            | Environment and Resources Authority, Malta                                                                                                                                                                                                                                             |
| **URL**                             | `https://era.org.mt/`                                                                                                                                                                                                                                                                  |
| **Data type**                       | Official Maltese air-quality information; the authoritative source, and the operator of all five monitoring stations                                                                                                                                                                   |
| **Observed / forecast / editorial** | Would be **observed** plus editorial                                                                                                                                                                                                                                                   |
| **Licensing**                       | Not established — the terms page could not be retrieved                                                                                                                                                                                                                                |
| **Refresh frequency**               | Unknown                                                                                                                                                                                                                                                                                |
| **Coverage**                        | Malta and Gozo                                                                                                                                                                                                                                                                         |
| **Authentication**                  | Unknown                                                                                                                                                                                                                                                                                |
| **Rate limits**                     | Unknown                                                                                                                                                                                                                                                                                |
| **Reliability**                     | **Unreachable from a server.** HTTP 403 behind Cloudflare bot protection on every path probed, including static `wp-content` assets, with a realistic desktop `User-Agent` and with the platform fetcher (**observed** 2026-07-26)                                                     |
| **Fallback**                        | ERA's measurements reach maqua.app through the EEA dissemination layer (§1), reported by Malta under Directive 2008/50/EC                                                                                                                                                              |
| **Status**                          | **Documented-unverified stub.** `src/lib/air-quality/providers/era-provider.ts` throws `EraProviderNotConfiguredError` unless an operator supplies a genuinely verified `ERA_AIR_QUALITY_URL`. **No endpoint URL is written anywhere in the codebase, because none was ever observed** |

`era.org.mt` is on the outbound allowlist so that a future verified integration
needs no security change — the host being permitted is not a claim that an
endpoint exists.

---

## 5. EEA Parquet download service — allowlisted, deliberately unused

| Field                               | Value                                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hosts**                           | `eeadmz1-downloads-api-appservice.azurewebsites.net`, `eeadmz1-downloads-webapp.azurewebsites.net`                                                              |
| **Data type**                       | Bulk historical air-quality data, zip-wrapped Parquet                                                                                                           |
| **Observed / forecast / editorial** | Observed, including quality-assured (E1a) archives                                                                                                              |
| **Why unused**                      | It is a batch-analytics interface. A serverless function cannot answer a page request by downloading and unzipping a Parquet archive (`docs/DATA_SOURCE.md` §1) |
| **Potential future use**            | Offline backfill of quality-assured history into Neon — an out-of-band job, never a request-path dependency                                                     |
| **Status**                          | Allowlisted for that eventual job; **not called by any code today**                                                                                             |

---

## 6. Editorial, news and social sources — none

No news feed, press release, social media source or scraped editorial content is
used, and none is currently planned.

The reasons are the same three every time, and none of them is solved by trying
harder:

1. **Licensing.** Most news content is not licensed for redistribution, and
   quoting it inside a health-adjacent product is a legal question rather than a
   technical one.
2. **Verifiability.** maqua.app's rule is that it does not assert what it cannot
   support. An unstructured feed cannot be validated at the boundary the way a
   Zod-parsed JSON payload can.
3. **Prompt injection.** Editorial text is the highest-risk category of untrusted
   input to place near a language model (`docs/AI_USAGE.md` §10). Excluding it
   removes the risk rather than mitigating it.

If an editorial source is ever added, it must arrive with: a written licence
permitting the use, a stable structured format, an entry in
`ALLOWED_UPSTREAM_HOSTS`, a Zod schema, a cache policy, an id-based citation
record, and an entry in this table. Its output must be visibly attributed and
clearly separated from measurements.

---

## 7. Rules that apply to every context source

1. **Context never changes a measurement.** No context value feeds
   `calculateSubIndex()`, `calculateCategory()`, `calculateOverall()` or any
   threshold comparison. The dependency is one-way.
2. **Modelled is labelled.** Every one of the sources above is model output, not
   observation. Each is labelled as such, with the model or service named.
3. **Attribution travels with the data.** Open-Meteo is CC-BY-4.0: attribution
   appears wherever its data appears, not only in a footer.
4. **Allowlisted hosts only.** `assertAllowedUrl()` permits exact hostnames over
   HTTPS. Adding a source is a reviewed code change to
   `src/lib/security/allowlist.ts`, never a configuration change.
5. **Validated at the boundary.** Every payload is Zod-parsed before use. A shape
   change surfaces as a clean logged failure, not as `undefined` in a template.
6. **Server-side only.** No browser contacts a context provider directly.
7. **Cached deliberately.** Every source has an entry in `cachePolicy`. Upstream
   request volume is a function of the policy, not of traffic.
8. **Absent is absent.** A missing context value produces an omitted panel and,
   where relevant, an explicit "not available". Never a zero, never a plausible
   substitute.
9. **Context degrades independently.** A context outage must not affect the
   air-quality reading, the map, or the API's `data` block. It affects only the
   context panel.
10. **Citations are id-based.** Where a context item is referenced in generated
    prose, the id is validated against the server's own set and resolved back to
    a server-held URL. The model never supplies a URL (`docs/AI_USAGE.md` §10).

---

## 8. Attribution strings

Air quality, verbatim wherever data is shown:

> Air-quality data provided by Malta's Environment and Resources Authority (ERA),
> disseminated via the European Environment Agency (EEA). maqua.app is an
> independent project and is not operated by, affiliated with, or endorsed by ERA
> or the EEA.

Weather and dust context, wherever it appears:

> Weather and atmospheric context from Open-Meteo (CC-BY-4.0), derived from
> national weather services and the Copernicus Atmosphere Monitoring Service
> (CAMS).
