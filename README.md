# maqua.app — **M**alta **A**ir **QUA**lity

Live air-quality readings, forecasts and environmental context for **Malta and Gozo**, built on official monitoring data.

maqua.app is an independent public-interest project. **Malta's Environment and Resources Authority (ERA) is the authoritative source** for official Maltese air-quality measurements; this is a visualisation of their data, not a replacement for it.

---

## What it does

A map-first dashboard that answers, in about five seconds:

- What is the air like right now, across both islands?
- Which stations are reporting, and which are stale?
- Which pollutant is driving the current rating?
- Is it safe to go outside, and for whom?
- What is likely to happen over the next couple of days, and why?

Technical measurements are translated into cautious, plain-language guidance. No scientific background is needed to understand whether the air is safe.

---

## Where the data comes from

Five monitoring stations, all operated by ERA:

| Station       | Island   | Type        | Setting        |
| ------------- | -------- | ----------- | -------------- |
| Attard        | Malta    | Background  | Urban          |
| Msida         | Malta    | **Traffic** | Urban          |
| St Paul's Bay | Malta    | **Traffic** | Urban          |
| Żejtun        | Malta    | Background  | Urban          |
| Għarb         | **Gozo** | Background  | Rural-regional |

Readings reach maqua.app through the **European Environment Agency's** European AQI dissemination layer, which publishes the measurements Malta reports under Directive 2008/50/EC. Data is republished **hourly**, roughly **58 minutes** after the measurement hour.

**A direct ERA integration was attempted and is not possible from a server.** `era.org.mt` returns HTTP 403 to every non-browser client, including static assets. Rather than invent an endpoint, the ERA provider is a documented stub that refuses to run without a verified URL. The full probe record is in [`docs/DATA_SOURCE.md`](docs/DATA_SOURCE.md).

---

## Scientific accuracy

The European AQI implementation is **verified, not assumed**. An oracle test checks our independent implementation against **6,760 real observed (concentration, sub-index) pairs** captured from upstream:

```
✓ reproduces the upstream sub-index for every real observation  (0 mismatches)
✓ agrees with the upstream band on every observation            (0 mismatches)
```

That test caught two genuine bugs during development:

1. **Band boundaries are integer-inclusive, not half-open.** The index rounds concentrations to whole µg/m³ first, so PM10 at 15.48 µg/m³ is _Good_ — it rounds to 15. Modelling the bands as half-open real intervals `[15, 45)` classified it as _Fair_. Wrong at every boundary.
2. **Trace negative concentrations are real measurements.** Analysers report values like −0.02 µg/m³ when a pollutant sits below the detection limit. That is clean air, not missing data. Rejecting all negatives discarded valid readings.

Thresholds live in exactly one place, [`src/config/thresholds.ts`](src/config/thresholds.ts). No concentration literals appear in UI components.

Full methodology: [`docs/AQI_METHODOLOGY.md`](docs/AQI_METHODOLOGY.md).

---

## Principles the code actually enforces

These are tested, not aspirational:

- **A missing value is never zero.** `value === null` renders as _Not available_.
- **Stale data is never called live.** Every reading carries measured-at, retrieved-at, and an age.
- **A forecast is never shown as an observation.** The upstream feed gap-fills _past_ hours too, so the wall clock cannot distinguish them — the `modelled` flag does.
- **Colour is never the only signal.** Every category pairs colour with a text label, an icon and a pattern.
- **AI never computes anything scientific.** It explains; it does not calculate AQI, thresholds, or timestamps. All output is schema-validated and falls back to deterministic prose.
- **One hourly reading never proves an annual legal breach.** Threshold comparisons carry a `conclusive` flag that the UI must respect.

---

## Local development

Requires Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

That is enough. **No credentials are needed**: with no database, Redis, AI key or email key, the app still serves the live map, the station list and the full API.

For fully offline work, replay real captured payloads instead of contacting the EEA:

```bash
AIR_QUALITY_PROVIDER=fixture pnpm dev
```

### Commands

```bash
pnpm dev          # development server
pnpm build        # production build
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
pnpm test         # unit + component tests (Vitest)
pnpm test:e2e     # end-to-end tests (Playwright)
pnpm db:generate  # generate Drizzle migrations
pnpm db:migrate   # apply migrations
pnpm db:studio    # Drizzle Studio
pnpm format       # Prettier
```

No test contacts ERA, the EEA, OpenRouter, Resend or any weather API.

---

## Optional services

Every one of these is genuinely optional. The app degrades rather than breaks.

| Service             | Enables                                 | Without it                                         |
| ------------------- | --------------------------------------- | -------------------------------------------------- |
| **Neon** PostgreSQL | Historical trends, alert subscriptions  | Live readings work; history unavailable            |
| **Upstash** Redis   | Distributed cache, locks, rate limiting | Falls back to a per-instance in-process cache      |
| **OpenRouter**      | AI "Explain this"                       | Deterministic explanation built from measured data |
| **Resend**          | Email alerts                            | Alerts page states it is not enabled               |
| **Sentry**          | Error monitoring                        | Structured console logging only                    |

Setup for each is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Architecture

```
Browser
  └─> maqua.app route handler        validation, envelope, rate limiting
        └─> Upstash Redis            15-min TTL, stale-while-revalidate, single-flight
              └─> AirQualityProvider  eea | fixture | era (stub)
                    └─> upstream      allowlisted hosts only
        └─> Neon                     historical snapshots
```

The browser **never** contacts an upstream provider. The server decides how often external sources are queried — upstream sees at most about four requests an hour regardless of traffic.

The UI depends only on internal types, never on an upstream response shape. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Documentation

| Document                                                  | Contents                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| [`DATA_SOURCE.md`](docs/DATA_SOURCE.md)                   | What was probed, what was found, what was not — the discovery record |
| [`AQI_METHODOLOGY.md`](docs/AQI_METHODOLOGY.md)           | Categories, breakpoints, legal limits vs WHO guidelines              |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md)                 | Providers, caching, freshness, degradation                           |
| [`FORECAST_METHODOLOGY.md`](docs/FORECAST_METHODOLOGY.md) | Where the outlook comes from and its limits                          |
| [`CONTEXT_SOURCES.md`](docs/CONTEXT_SOURCES.md)           | Every environmental-context provider and its licence                 |
| [`AI_USAGE.md`](docs/AI_USAGE.md)                         | Model config, privacy, validation, cost controls                     |
| [`DEPLOYMENT.md`](docs/DEPLOYMENT.md)                     | Vercel, Neon, Upstash, DNS, cron, rollback                           |

---

## Limitations

Stated plainly, because a data product that hides its uncertainty is not trustworthy:

- **Five stations for two islands.** Coverage is sparse; Gozo has one rural station. maqua.app therefore shows station readings and deliberately does **not** fabricate a continuous pollution surface or imply street-level precision.
- **Near-real-time data is unverified.** E2a values may be revised or withdrawn. Every reading is labelled provisional.
- **The upstream is not a contractual API.** It is the public backing store for the EEA's own AQI map. Paths could change without notice. Zod validates every payload so a break degrades cleanly rather than corrupting data.
- **Not a direct ERA feed.** Timing and revisions may differ from ERA's own publications. ERA remains authoritative.
- **Forecasts are modelled estimates**, not measurements, and are always labelled as such.

---

## Attribution

> Air-quality data provided by Malta's Environment and Resources Authority (ERA), disseminated via the European Environment Agency (EEA). maqua.app is an independent project and is not operated by, affiliated with, or endorsed by ERA or the EEA.

Map tiles © OpenStreetMap contributors. Weather and atmospheric context from Open-Meteo (CC-BY-4.0). The European Air Quality Index methodology, category names, colours and health advice originate with the EEA.

---

## Health disclaimer

> maqua.app provides general environmental information and does not replace medical advice or official emergency guidance.

---

## Licence

MIT — see [`LICENSE`](LICENSE).
