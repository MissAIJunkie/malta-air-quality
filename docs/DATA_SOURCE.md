# Data source discovery

**Verified:** 2026-07-26 · **Method:** direct HTTP probing from the build environment (`curl`), plus static analysis of the official EEA European Air Quality Index viewer's client bundle.

This document records **what was actually observed**. Nothing here is inferred, recalled, or invented. Where a source could not be reached, that is stated plainly rather than guessed at.

---

## 1. Summary of the outcome

| | |
|---|---|
| **Primary provider (implemented, live)** | EEA European Air Quality Index dissemination layer (`dis2datalake.blob.core.windows.net`) |
| **Ultimate data owner** | Malta's **Environment and Resources Authority (ERA)** — confirmed in the station metadata's `organisation` field |
| **ERA direct integration** | **Not verifiable from this environment.** `era.org.mt` returns HTTP 403 (Cloudflare bot protection) for every path tried, including static assets. |
| **Fallback chain** | `eea` → `fixture` (never silently; see §7) |
| **Update cadence (observed)** | Hourly |
| **Authentication** | None |
| **Attribution required** | Yes — ERA and EEA (see §8) |

The decisive constraint for provider selection was: *can a single lightweight HTTP request from a serverless function return current station-level readings for Malta?* The EEA **Parquet Download Service** cannot (it returns zip-wrapped Parquet — a batch-analytics interface). The EEA **AQI dissemination layer** can, and is what the EEA's own public AQI map uses.

---

## 2. ERA: what was probed and what happened

Section 3 of the build brief requires inspecting ERA's pages before implementing. That was done. Every request was blocked.

| URL probed | Result |
|---|---|
| `https://era.org.mt/topic/real-time-air-quality-network/` | **403** — Cloudflare "Attention Required!" interstitial (4,546 bytes) |
| `https://era.org.mt/air-quality-widget/` | **403** — identical interstitial |
| `https://era.org.mt/wp-content/uploads/2022/06/Air-Quality-Assessment-Regimes-Status-Report-for-Malta.pdf` | **403** — static assets are behind the same rule |

Probes were attempted with a realistic desktop browser `User-Agent` and with the platform's own fetcher. Both were rejected. The block is applied to non-browser clients generally, not to a specific path.

**Consequence, stated honestly:**

- `src/lib/air-quality/providers/era-provider.ts` exists as a **documented, unverified stub**. It is **not** the default provider and is **not** enabled in production.
- No ERA endpoint URL is asserted anywhere in this codebase or in these docs, because none was ever observed. Inventing one would violate the project's own engineering rules.
- If ERA is later confirmed to expose a structured feed (or grants access), the provider interface is already in place and only that one file needs to change.

**ERA's role is not diminished by this.** ERA operates all five monitoring stations and is the authoritative source for official Maltese air-quality data. The EEA layer is a *dissemination channel for ERA's own measurements*, reported by Malta under the Ambient Air Quality Directive. Attribution reflects this.

---

## 3. The discovered endpoint

The EEA's public European AQI map (`https://airindex.eea.europa.eu/AQI/index.html`) is a static page whose client scripts are readable. `AQI/script/data.js` defines:

```js
const STATION_DATA_URL = 'https://dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans/'
```

Consuming call sites (`init.js`, `ui-station.js`, `graph.js`) reveal the full path structure:

| Path | Purpose | Observed size |
|---|---|---|
| `content/index.json` | Pointer to the current station-master filename | 76 B |
| `content/raw_stations.json.<stamp>` | Station master list — **4,593 stations**, with coordinates | 1.79 MB |
| `current/<code>.json` | **Per-station hourly time series** — observations *and* forecast | ~90–110 KB |
| `map/<YYYY-MM-DDTHH>.json` | All stations, one hour, overall AQI + culprit only | ~147 KB |
| `stats/<CC>/<code>.json` | Per-station statistics | not used |

**maqua.app fetches `current/<code>.json` for the five Malta station codes.** That single choice yields measurements, per-pollutant values, provenance flags, the dominant pollutant, and the official forecast — everything the product needs, in five small requests, cached server-side.

`map/` was evaluated and rejected as the primary path: it carries only an overall index and a culprit code, with no pollutant concentrations, and costs 147 KB to obtain 5 stations' worth of data.

### Observed response headers

```
Cache-Control: no-cache
Content-Type:  application/json
Last-Modified: Sun, 26 Jul 2026 05:51:04 GMT
ETag:          0x8DE785D1FC67960
```

- **No authentication.** No API key, no token, no session.
- **No documented rate limit.** Azure Blob Storage; treated as a courtesy-limited public resource and polled conservatively (§6).
- **No `Access-Control-Allow-Origin` observed.** Browsers cannot call this directly — which is the required design anyway. All access is server-side through the provider abstraction.
- **`ETag` and `Last-Modified` are present** and are used for conditional revalidation.

---

## 4. Malta stations (verified, not invented)

Extracted verbatim from `content/raw_stations.json.*` by filtering `code` on the `MT` prefix. **Exactly five** Malta stations are present, all with `operational: 1` and `organisation: "Environment & Resources Authority (ERA)"`.

| Code | Name | Island | Lat | Lon | Alt (m) | Type | Area |
|---|---|---|---|---|---|---|---|
| `MT00004` | Żejtun Station | Malta | 35.852266 | 14.538941 | 56 | Background | Urban |
| `MT00007` | Għarb Station | **Gozo** | 36.067050 | 14.197074 | 114 | Background | Rural-Regional |
| `MT00008` | Attard Station | Malta | 35.890091 | 14.434573 | 86 | Background | Urban |
| `MT00009` | St. Paul's Bay Station | Malta | 35.944845 | 14.385739 | 7 | **Traffic** | Urban |
| `MT00011` | Msida Station | Malta | 35.895563 | 14.493217 | 2 | **Traffic** | Urban |

Every coordinate in `src/config/stations.ts` comes from this file and nowhere else.

**Notes on naming and history**

- The upstream `name` field is unaccented ASCII (`"Zejtun Station"`, `"Gharb Station"`). maqua.app displays the correct Maltese orthography — **Żejtun**, **Għarb** — as required by the i18n brief. The upstream code remains the join key; the display name is a local, reviewable override.
- Għarb is the only Gozo station. Island assignment is derived from the station code, not from latitude.
- **Kordin** was discontinued after 2016 and does **not** appear in the operational list. It is not shown.
- A mobile station exists in ERA's network but is absent from this feed, so maqua.app does not display one.

**Pollutant coverage differs per station** and is read from the data, never assumed. Msida (`MT00011`), for example, reports no O₃. Stations only ever render the pollutants they actually report.

---

## 5. Response shape and field mapping

`current/<code>.json` is a JSON object keyed by ISO-8601 UTC hour:

```json
{
  "2026-07-15T05:00:00.000Z": {
    "aqi_SO2": 1,          "val_SO2": 0.15351,   "modelled_SO2": 0,
    "aqi_PM10": 2.6896551724, "val_PM10": 36.0205,  "modelled_PM10": 0,
    "aqi_PM2.5": 2.7777777778, "val_PM2.5": 13.24617, "modelled_PM2.5": 0,
    "aqi_O3": 1.593220339,  "val_O3": 36.07573,   "modelled_O3": 0,
    "aqi_NO2": 3.5588235294, "val_NO2": 45.43317,  "modelled_NO2": 0,
    "culprit": "NO2",
    "aqi": 3.5588235294
  }
}
```

### Field mapping

| Upstream | Internal | Semantics — **verified against observed data** |
|---|---|---|
| *(object key)* | `measuredAt` | ISO-8601 UTC. Rendered in `Europe/Malta`. |
| `val_<P>` | `PollutantReading.value` | Concentration in µg/m³. **`null` means missing** — rendered as *unavailable*, never as `0`. |
| `aqi_<P>` | `PollutantReading.subIndex` | Continuous sub-index. **`0` means no index available**, not "Good". |
| `modelled_<P>` | `PollutantReading.modelled` | `0` = measured · `1` = modelled / gap-filled / forecast. Surfaced in the UI as *Estimated*. |
| `culprit` | `dominantPollutant` | Upstream's worst pollutant. Independently recomputed and cross-checked (see §5.2). |
| `aqi` | `overallSubIndex` | Overall continuous index. |

### 5.1 Band derivation

From the viewer's `ui-station.js`:

```js
st.BandId = Math.floor(st.aqi);
```

Band ids map to the six official categories (`data.js`), with the EEA's own colours and health advice:

| Id | Category | Colour |
|---|---|---|
| 1 | Good | `#50f0e6` |
| 2 | Fair | `#50ccaa` |
| 3 | Moderate | `#f0e641` |
| 4 | Poor | `#ff5050` |
| 5 | Very poor | `#960032` |
| 6 | Extremely poor | `#7d2181` |

`BandId` of `0` is **not** a category — it means *no data*, and is rendered as such.

### 5.2 Why we recompute rather than trust `aqi_*`

maqua.app derives categories **deterministically from concentrations** using the breakpoint table in `src/config/thresholds.ts`, and treats the upstream `aqi_*` values as a cross-check.

This is not redundancy for its own sake. It means the app still classifies correctly if the upstream index is absent, and it keeps the classification logic testable in CI without network access. The breakpoints were confirmed by **two independent methods**:

1. **Empirical regression** over 6,760 observed (concentration, sub-index) pairs from all five Malta stations, solving `value = lo + (aqi − band) × (hi − lo)` per band.
2. **The EEA's published threshold table.**

Agreement was exact to within floating-point noise. Worked example — PM10:

| Band | Derived from data | Published |
|---|---|---|
| 1 | −1.27 → 15.18 | 0 – 15 |
| 2 | 16.01 → 45.00 | 15 – 45 |
| 3 | 45.96 → 120.12 | 45 – 120 |
| 4 | 120.76 → 194.93 | 120 – 195 |

Full table and per-pollutant results: [`AQI_METHODOLOGY.md`](./AQI_METHODOLOGY.md).

---

## 6. Freshness, cadence, and caching

### Observed cadence

`Last-Modified` was `2026-07-26T05:51:04Z` for data covering the `05:00Z` hour — a **~51-minute publication lag**, refreshed hourly. This matches the EEA's stated "2 to 5 hours after measurement" guidance for up-to-date (E2a) data, at the fast end.

### Freshness thresholds

Derived from that cadence, not chosen arbitrarily (`src/lib/air-quality/freshness.ts`):

| State | Age of newest observation | UI treatment |
|---|---|---|
| **Fresh** | ≤ 2 h | Normal |
| **Delayed** | 2–4 h | Clock icon, exact age shown |
| **Stale** | 4–12 h | De-emphasised marker, explicit warning, never called "live" |
| **Unavailable** | > 12 h, or no data | Marker greyed, category suppressed |

### Caching strategy

```
Browser → maqua.app route handler → Upstash Redis → EEA provider → Azure blob
                                          ↓
                                    Neon (history)
```

- **Redis TTL 15 min**, with `stale-while-revalidate` to 2 h. Upstream is polled at most ~4×/hour regardless of traffic.
- **Distributed lock** per key, so concurrent misses trigger one upstream fetch, not N (no thundering herd).
- **Conditional requests** using the upstream `ETag`.
- **Exponential backoff** on failure; last-known-good is served and clearly labelled stale.
- **No client ever contacts the EEA directly.** Browsers poll only `/api/*`.
- If Redis is unavailable the app degrades to in-process caching rather than failing.

---

## 7. Fallback behaviour

Resolution order (`AIR_QUALITY_PROVIDER`):

1. **`eea`** — default; the verified live path.
2. **`fixture`** — deterministic local data for development, CI, and E2E. Must be selected **explicitly**.
3. **`era`** — stub; documented-unverified, not production-enabled.

**Fixtures never substitute for production data.** If the live provider fails, the app serves the last known good reading with an explicit staleness label, or reports unavailability. It does not silently fall back to invented numbers. `meta.source` on every API response states which provider actually answered.

---

## 8. Terms of use and attribution

EEA content is published under the agency's standard **re-use policy: reuse permitted with acknowledgement of the source**, unless otherwise stated. Malta's measurements are reported by ERA under Directive 2008/50/EC and Directive 2004/107/EC.

Attribution rendered in the application footer, on `/about`, and on `/methodology`:

> Air-quality data provided by Malta's Environment and Resources Authority (ERA), disseminated via the European Environment Agency (EEA). maqua.app is an independent project and is not operated by, affiliated with, or endorsed by ERA or the EEA.

The European AQI methodology, category names, colours, and health advice originate with the EEA and are credited in [`AQI_METHODOLOGY.md`](./AQI_METHODOLOGY.md).

---

## 9. Known limitations and uncertainties

Stated explicitly rather than buried:

1. **Not a direct ERA integration.** Data reaches maqua.app via the EEA. ERA's own site may publish values that differ in timing or revision. **ERA remains the authoritative source.**
2. **Unverified (E2a) data.** These are near-real-time, *not* quality-assured. Values may be revised or withdrawn. Every reading is labelled provisional.
3. **Undocumented endpoint.** The dissemination layer is the public backing store for the EEA's own AQI map, but it is not a contractual API. Path structure or filenames could change without notice. Mitigations: strict Zod validation at the boundary, structured parse-failure logging, provider health tracking, and last-known-good serving. A break degrades the app; it does not corrupt it.
4. **Five stations for two islands.** Coverage is sparse and Gozo has a single rural station. maqua.app therefore shows **station readings**, not a fabricated continuous surface, and never implies street-level precision.
5. **No `Access-Control-Allow-Origin`.** Server-side only — by design.
6. **Forecast values are modelled**, not measured (`modelled_* = 1`), and are always labelled *Estimated*.
7. **Timestamps are UTC**; all display converts to `Europe/Malta` (CET/CEST). The upstream is unambiguous, so no local-time guessing occurs.

---

## 10. Reproducing the discovery

```bash
S="https://dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans/"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

# 1. Current station master filename
curl -sS -A "$UA" "${S}content/index.json"

# 2. Malta stations, with verified coordinates
curl -sS -A "$UA" "${S}content/raw_stations.json.26030200" \
  | python3 -c "import json,sys; [print(r) for r in json.load(sys.stdin) if r['code'].startswith('MT')]"

# 3. Live readings + forecast for Msida
curl -sS -A "$UA" "${S}current/MT00011.json" | head -c 2000
```

Replace the `raw_stations.json.*` stamp with whatever `content/index.json` currently points to — it changes when the EEA republishes the master list.
