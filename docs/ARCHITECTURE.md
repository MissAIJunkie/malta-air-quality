# Architecture

**Written:** 2026-07-26 · Describes the code as committed. Where a subsystem is
planned but not yet present, it says so rather than describing it in the present
tense.

---

## 1. The three rules that shape everything

**The UI never depends on an upstream shape.** Providers normalise into the
domain model in `src/lib/air-quality/types.ts` (`StationReading`,
`PollutantReading`, `HistoricalReading`, `MaltaSummary`, `ResponseMeta`). No
component, page or route handler reads `val_PM10`, `aqi_NO2` or `modelled_O3`.
The upstream is a public backing store rather than a contractual API
(`docs/DATA_SOURCE.md` §9) — when its shape changes, exactly one file changes.

**No browser ever contacts an upstream directly.** The dissemination layer sends
no `Access-Control-Allow-Origin`, which is convenient, but the design would be
the same either way: the server decides how often external sources are queried,
so caching is the mechanism rather than an optimisation. Browsers poll `/api/*`
only.

**Missing data is missing.** `null` propagates through the domain model as
`null`. It is never coerced to `0`, never rendered as `0`, and never classified as
"Good". Every layer — schema, provider, index calculation, response envelope —
preserves the distinction between _measured zero_ and _not measured_.

---

## 2. Directory map

```
src/
  app/
    layout.tsx                       Root layout
    page.tsx                         Home
    globals.css                      Tailwind v4 @theme tokens
    api/
      air-quality/route.ts           GET readings + Malta summary
      explain/route.ts               POST plain-language explanation
      context/route.ts               GET environmental context
      alerts/{subscribe,confirm,unsubscribe}/
                                     Alert subscription lifecycle
  components/ui/                     Radix-based primitives
  config/
    pollutants.ts                    POLLUTANT_CODES, POLLUTANTS registry
    thresholds.ts                    AQI breakpoints, EU limits, WHO guidelines,
                                     category presentation. Every threshold
                                     number in the app lives here.
    stations.ts                      The five verified ERA stations
    env.ts                           Zod-validated env + getCapabilities()
    openrouter.ts                    PROMPT_VERSION, model defaults, resilience.
                                     Every model identifier lives here.
  db/                                Drizzle schema, client, queries, retention.
                                     Optional — client.ts returns null with no
                                     DATABASE_URL.
  lib/
    air-quality/
      types.ts                       The domain model the UI depends on
      schemas.ts                     Zod schemas for upstream + query params
      calculate-index.ts             Pure European AQI implementation
      freshness.ts                   Pure freshness classification
      service.ts                     Provider selection, caching, envelope
                                     ('server-only')
      providers/
        eea-provider.ts              Verified live source
        era-provider.ts              Documented-unverified stub
        fixture-provider.ts          Deterministic replay of real payloads
      __tests__/calculate-index.test.ts
    ai/                              openrouter-client (server-only transport),
                                     redact, prompts, schemas, validate, cache,
                                     fallback
    environmental-context/           open-meteo-provider, cams-dust-provider,
                                     classify-event, deduplicate, relevance,
                                     service, schemas, types
    forecast/                        eea-cams-provider (splits the series
                                     already fetched), confidence, types
    notifications/                   resend-client, tokens, evaluate-alerts,
                                     rate-limit
    i18n/                            dictionary, format, index
    cache/
      upstash.ts                     cached(), withLock(), in-process fallback
      keys.ts                        cacheKeys.*, cachePolicy.*
    api/respond.ts                   ok/badRequest/notFound/… + error mapping
    monitoring/logger.ts             Structured JSON logging with redaction
    security/allowlist.ts            Outbound host allowlist (SSRF defence)
    security/rate-limit.ts           Per-caller limiting for public endpoints
    utils/cn.ts                      Tailwind class merge
drizzle.config.ts                    drizzle-kit only; the app never loads it
fixtures/
  upstream-station-sample.json       Real captured payload — fixture provider
  upstream-aqi-oracle.json           615 real (value, sub-index) pairs — CI
  upstream-stations-mt.json          Real Malta station metadata
docs/
  DATA_SOURCE.md                     The discovery record (authoritative)
  AQI_METHODOLOGY.md                 Index, limits, guidelines
  ARCHITECTURE.md                    This file
  DEPLOYMENT.md                      Vercel guide
  AI_USAGE.md                        AI policy and required behaviour
  CONTEXT_SOURCES.md                 Environmental context providers
  FORECAST_METHODOLOGY.md            Where the forecast comes from
```

**Not yet present as of 2026-07-26**, and referenced elsewhere as planned rather
than built: `vercel.json`; the `/api/health` route named in `src/config/env.ts`;
the `/api/cron/*` routes; and the route handler exposing AI explanations. This
list is a snapshot — check the tree before relying on it.

---

## 3. Provider abstraction

```ts
interface AirQualityProvider {
  readonly name: ProviderSource; // 'EEA' | 'ERA' | 'FIXTURE'
  getStations(): Promise<AirQualityStation[]>;
  getLatestReadings(): Promise<StationReading[]>;
  getStationHistory?(id: string, o: HistoryOptions): Promise<HistoricalReading[]>;
}
```

`getStationHistory` is optional; `service.getStationHistory()` returns `[]` when a
provider does not implement it, rather than throwing.

Selection is a single `switch` on `AIR_QUALITY_PROVIDER` in `getProvider()`.

| Provider    | Value           | Status                                                                                                                                                                                                                        |
| ----------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EEA**     | `eea` (default) | The verified live path. Reads `current/<CODE>.json` for the five Malta codes from the EEA dissemination layer.                                                                                                                |
| **Fixture** | `fixture`       | Deterministic replay of a real captured payload, timestamps rebased onto the current hour. Must be selected **explicitly**.                                                                                                   |
| **ERA**     | `era`           | Documented-unverified stub. Throws `EraProviderNotConfiguredError` unless `ERA_AIR_QUALITY_URL` is set to a genuinely verified endpoint. No endpoint URL is written anywhere in the codebase, because none was ever observed. |

**The fixture provider is never an automatic fallback.** If the live provider
fails, the app serves last-known-good with an explicit staleness label, or
reports unavailability. It does not silently substitute invented numbers.
`meta.source` on every response states which provider actually answered, so
fixture data cannot be mistaken for production data.

### What the EEA provider does that is not obvious

- **`measuredAt` is the newest hour with `modelled_* === 0`, never the newest key
  in the payload.** The newest key sits roughly 48 hours in the future — it is
  CAMS forecast. Taking the last key would present a forecast as a live reading.
- **The current hour is filtered to measured values before the category is
  computed.** Modelled gap-fills within that hour are excluded from
  `calculateOverall()`, so the headline category can never be driven by an
  estimate presented as an observation.
- **Station geometry is not adopted from upstream at runtime.** The live station
  list is fetched to detect drift — a station going non-operational, an unknown
  new `MT*` code, coordinates diverging by more than `1e-4` — and each is logged
  as a warning. Adopting a new station requires a reviewed commit with verified
  coordinates and the correct Maltese orthography.
- **One station failing does not blank the others.** Fetches run under
  `Promise.allSettled`; a rejected station is logged and omitted, and
  `meta.partial` tells the client.

---

## 4. Request flow

```
Browser
  │  GET /api/air-quality?station=msida
  ▼
Route handler  src/app/api/air-quality/route.ts
  │  · Zod-validates ?station and ?pollutant
  │  · runtime = 'nodejs', dynamic = 'force-dynamic'
  ▼
Service        src/lib/air-quality/service.ts   ('server-only')
  │  · getProvider()
  │  · cached(cacheKeys.latestReadings(provider.name), cachePolicy.latestReadings, …)
  ▼
Cache          src/lib/cache/upstash.ts
  │  · fresh hit  → return, cached: true, stale: false
  │  · in-flight  → await the existing promise (per instance)
  │  · miss/expired → call the provider
  ▼
Provider       src/lib/air-quality/providers/eea-provider.ts
  │  · assertAllowedUrl()  — exact-host allowlist, HTTPS only
  │  · fetch with a 10 s AbortController timeout, cache: 'no-store'
  │  · Zod-parse, normalise, classify
  ▼
Upstream       dis2datalake.blob.core.windows.net  (5 requests, ~90–110 KB each)
```

Back out through the same layers: the service computes `summariseMalta()` and the
`ResponseMeta` envelope, the route applies any `?station` / `?pollutant` filter to
the _view_ (the summary always reflects all stations and all pollutants), and
`respond.ok()` wraps it as `{ data, meta }` with a CDN cache header.

**Neon (PostgreSQL)** sits beside this path, not inside it. Its role is persisted
history beyond the upstream's ~10-day window, alert subscriptions, provider
health and audit trails — written by scheduled jobs, not by the read path.
`src/db/client.ts` returns `null` when `DATABASE_URL` is unset and every query
module degrades to a safe default, which is what keeps the database genuinely
optional rather than nominally optional.

---

## 5. Caching and single-flight

There are **two** cache layers with different numbers. Naming only one, or
averaging them, gives the wrong mental model.

### Layer 1 — Vercel's edge cache

Set by `respond.ok()` on every successful response:

```
cache-control: public, s-maxage=300, stale-while-revalidate=3600
```

This absorbs traffic bursts. It does not control how often upstream is queried.

### Layer 2 — Redis (Upstash), via `cached()`

`cachePolicy` in `src/lib/cache/keys.ts`, all in seconds:

| Policy           | TTL    | stale-while-revalidate | Rationale                                                                                                                                                                                             |
| ---------------- | ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `latestReadings` | 900    | 7200                   | Upstream republishes hourly with a ~58-minute lag, so polling more often than every 15 minutes cannot surface new data. Caps upstream traffic at roughly four requests an hour regardless of traffic. |
| `stations`       | 21 600 | 86 400                 | Station geometry effectively never changes.                                                                                                                                                           |
| `stationHistory` | 1 800  | 7 200                  |                                                                                                                                                                                                       |
| `weather`        | 1 800  | 7 200                  |                                                                                                                                                                                                       |
| `contextEvents`  | 1 800  | 10 800                 |                                                                                                                                                                                                       |
| `forecast`       | 3 600  | 10 800                 |                                                                                                                                                                                                       |

Keys are namespaced and versioned (`v1:aq:latest:EEA`). Bumping `VERSION`
invalidates a whole class of entries after a shape change, which is safer than
migrating cached values in place.

### Stale-while-revalidate and degradation

`cached()` returns `{ value, cached, stale, degradedReason? }`.

- Within TTL → served from cache.
- Past TTL, upstream succeeds → fresh value written, `cached: false`.
- Past TTL, **upstream fails**, entry still inside the SWR window → the stale
  value is returned with `degradedReason: 'upstream_unavailable'` and a
  `cache.serving_stale` warning is logged. The map stays usable during an outage,
  and `meta.stale` forces honest labelling.
- Past TTL, upstream fails, nothing cached → the error propagates and
  `handleRouteError()` maps it to a safe 500.

### Single-flight — the precise claim

There are two different mechanisms, and only one of them is distributed.

- **`cached()` uses an in-process `inflight` map.** Concurrent misses _within one
  serverless instance_ await a single upstream call rather than stampeding it.
  Across instances it does not coordinate: N simultaneously cold instances will
  produce N upstream fetches. With a 15-minute TTL and five small requests per
  fetch, that is acceptable against a public Azure blob; it is not, however, a
  distributed lock, and should not be described as one.
- **`withLock(key, ttl, fn)` is the distributed lock**, implemented as Redis
  `SET NX EX` with a random token and a token-checked release. It exists for
  scheduled jobs — `lockRefreshAirQuality`, `lockRefreshContext`,
  `lockEvaluateAlerts` — so two concurrent cron invocations do not both write
  history or both send the same alert. It is **not** used on the read path. If
  Redis is unavailable it runs `fn()` anyway rather than stalling the job, and
  when the lock is already held it returns `null`.

### Without Redis

`getRedis()` returns `null` when `getCapabilities().redis` is false, and every
read and write falls through to an in-process `Map`. That is per-instance rather
than distributed: correct, but with a lower hit rate across serverless instances.
A Redis _outage_ behaves the same way — reads and writes are wrapped in
try/catch, log `cache.read_failed` / `cache.write_failed`, and degrade to memory.
An unavailable cache never takes the app down.

---

## 6. Freshness model

Implemented in `src/lib/air-quality/freshness.ts`. Pure and clock-injectable —
`now` is always a parameter, so tests never depend on wall time.

Derived from the **measured** cadence, not from taste: the dissemination layer
republishes hourly, and on 2026-07-26 the newest genuinely measured hour across
all five Malta stations was `06:00Z`, published at `06:57Z`.

```ts
UPSTREAM_CADENCE_MINUTES = 60;
UPSTREAM_PUBLICATION_LAG_MINUTES = 58;
```

| State         | Age of newest observation      | Meaning                                              |
| ------------- | ------------------------------ | ---------------------------------------------------- |
| `fresh`       | ≤ 2 h                          | Normal operation, given hourly publication plus lag. |
| `delayed`     | 2 – 4 h                        | Late, but plausibly a delayed publication.           |
| `stale`       | 4 – 12 h                       | Old enough that it must not be presented as current. |
| `unavailable` | > 12 h, unparseable, or absent | Category suppressed.                                 |

Four behaviours worth stating explicitly:

- **An unknown age fails safe.** A missing or unparseable timestamp is
  `unavailable`, never `fresh`.
- **Future timestamps are `fresh`.** Forecast points are legitimately ahead of
  now. The forecast/observation distinction is carried separately, on
  `HistoricalReading.forecast`, rather than smuggled into freshness.
- **`isStale()` treats `delayed` as stale for labelling.** Anything beyond normal
  cadence is never called "live".
- **`worstFreshness()` never flatters.** The Malta summary and `meta.stale` take
  the most degraded state across stations, not the best or the average.

`nextExpectedUpdate()` = measurement + 60 min + 58 min, surfaced as
`meta.nextExpectedUpdateAt` so the UI can say when to look again rather than
inviting the reader to refresh.

### Forecast is decided by the data, not the clock

`isForecastPoint(ts, latestObservedIso)` compares against
`latestObservedTimestamp(points)` — the newest hour carrying at least one
`modelled_* === 0` value. It is deliberately **not** `timestamp > now`: the
upstream gap-fills _past_ hours with modelled values too, so a point eleven days
old can still be an estimate. See `docs/FORECAST_METHODOLOGY.md`.

---

## 7. Graceful degradation

`getCapabilities()` in `src/config/env.ts` gates every optional subsystem on its
own credentials being present:

```ts
{
  database:           Boolean(DATABASE_URL),
  redis:              Boolean(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN),
  ai:                 Boolean(OPENROUTER_API_KEY) && AI_EXPLANATIONS_ENABLED,
  aiContextSummaries: Boolean(OPENROUTER_API_KEY) && AI_CONTEXT_SUMMARIES_ENABLED,
  email:              Boolean(RESEND_API_KEY) && Boolean(ALERT_TOKEN_SECRET),
  cron:               Boolean(CRON_SECRET),
  weather:            WEATHER_PROVIDER !== 'none',
  monitoring:         Boolean(SENTRY_DSN),
}
```

### Degradation matrix

| Missing                                           | Still works                                                                                                                                                                                          | Lost                                                                                                | How it is presented                                                                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No database**                                   | Live readings, map, station pages, Malta summary, the API, **and short-window history** — `getStationHistory()` reads the provider, and each `current/<CODE>.json` carries roughly 10 days of series | **Stored** history beyond the upstream's ~10-day window; alert subscriptions; stored context events | History views state the window they cover. Alerts render an honest "not enabled on this deployment" state.                                                                                                           |
| **No Redis**                                      | Everything                                                                                                                                                                                           | Distributed caching, cross-instance single-flight, distributed locks, Redis-backed rate limiting    | Silent by design — the in-process `Map` takes over. Upstream request volume rises with the number of warm instances.                                                                                                 |
| **No AI**                                         | Everything                                                                                                                                                                                           | Model-written prose only                                                                            | `POST /api/explain` still returns **HTTP 200**, with `generated: 'fallback'` and a deterministic explanation built from the same measurements. The endpoint must not fail because AI failed. See `docs/AI_USAGE.md`. |
| **No email**                                      | Everything                                                                                                                                                                                           | Sending alerts, confirmation and unsubscribe links                                                  | Alerts are disabled outright — `email` requires **both** `RESEND_API_KEY` and `ALERT_TOKEN_SECRET`, because an alert you cannot unsubscribe from must never be sent.                                                 |
| **No `CRON_SECRET`**                              | Everything on the read path                                                                                                                                                                          | Scheduled refresh, history persistence, alert evaluation                                            | Cron routes return 401, so they are never publicly invocable.                                                                                                                                                        |
| **No Sentry**                                     | Everything                                                                                                                                                                                           | Error aggregation                                                                                   | Structured JSON logs still go to the platform log drain.                                                                                                                                                             |
| **No weather provider** (`WEATHER_PROVIDER=none`) | All air-quality features                                                                                                                                                                             | Meteorological context and dust context                                                             | Context panels are omitted rather than shown empty.                                                                                                                                                                  |
| **Upstream unavailable**                          | Last-known-good within the SWR window                                                                                                                                                                | Current data                                                                                        | `meta.stale = true`, `meta.degradedReason = 'upstream_unavailable'`, and the reading is labelled with its measured-at time and age. Never called live.                                                               |

The target case is a deployment with **`AIR_QUALITY_PROVIDER=fixture` and no
database, Redis, AI or email credentials**: the map, the station list, the API and
the full test suite all work. `getEnv()` cannot fail on a fresh deployment —
every field in the schema has a default or is `.optional()` — so it throws only
when a _supplied_ value is malformed.

---

## 8. Security boundary

- **Outbound allowlist.** `assertAllowedUrl()` permits only exact hostnames from
  `ALLOWED_UPSTREAM_HOSTS`, rejects non-HTTPS schemes and URLs carrying embedded
  credentials. Host comparison is exact, not suffix-based, because
  `evil-dis2datalake.blob.core.windows.net` would pass a naive `endsWith`. This
  is what stops a configuration mistake, a hostile redirect or an
  attacker-supplied URL from turning maqua.app into an open proxy or reaching
  cloud metadata endpoints. `EEA_AIR_QUALITY_URL` is configurable _and_ validated
  against this list, so it cannot be repointed at an arbitrary host.
- **Link rendering.** `isSafeExternalLink()` is looser — sources are cited that
  are never fetched — but still refuses anything that is not plain HTTPS, which
  blocks `javascript:` and `data:` URLs arriving from feeds or model output.
- **Server-only boundary.** `service.ts` imports `'server-only'`, and
  `config/env.ts` is documented as server-only. Secrets never reach the browser
  bundle.
- **Input validation.** Every query parameter is Zod-parsed before use; every
  upstream byte is Zod-parsed at the boundary. A shape change surfaces as a clean
  logged validation failure, not as `undefined` leaking into a category
  calculation.
- **Log redaction.** `logger` redacts any field whose key matches
  `/(key|token|secret|password|authorization|cookie|dsn|credential)/i` and
  truncates strings over 500 characters. Defence in depth: callers are expected
  not to log secrets, but an accidental one is non-catastrophic.
- **Error mapping.** `handleRouteError()` logs the full error server-side and
  returns a plain sentence with no stack trace, upstream hostname or internal
  detail.

---

## 9. Response envelope

Every successful route returns:

```jsonc
{
  "data": {/* route-specific */},
  "meta": {
    "source": "EEA", // which provider actually answered
    "measuredAt": "2026-07-26T06:00:00.000Z", // newest observation, UTC
    "fetchedAt": "2026-07-26T07:01:12.004Z", // when maqua.app retrieved it
    "nextExpectedUpdateAt": "2026-07-26T07:58:00.000Z",
    "stale": false, // data old OR knowingly cached after failure
    "partial": false, // a station or pollutant is missing
    "cached": true,
    "degradedReason": "upstream_unavailable", // only when serving last-known-good
  },
}
```

Failures return `{ error: { code, message } }` with `cache-control: no-store` and
one of a small set of codes: `bad_request`, `not_found`, `rate_limited`,
`unauthorized`, `upstream_unavailable`, `internal_error`.

`meta` is what makes the honesty rules enforceable at the UI layer: a component
cannot accidentally describe a reading as live, because `measuredAt`, `fetchedAt`
and `stale` all travel with it.
