<div align="center">

<img src="public/icon.svg" alt="" width="96" height="96">

# maqua.app

**M**alta **A**ir **QUA**lity — live readings, forecasts and environmental context for **Malta and Gozo**, built on official monitoring data.

[![Next.js 16](https://img.shields.io/badge/Next.js-16.2-black?style=flat-square&logo=nextdotjs)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19.2-087ea4?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![pnpm](https://img.shields.io/badge/pnpm-11.17-f69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

[What it does](#what-it-does) · [Quick start](#quick-start) · [Optional services](#optional-services) · [API](#api) · [Architecture](#architecture) · [Docs](#documentation)

</div>

---

maqua.app is an independent public-interest project. **Malta's Environment and Resources Authority (ERA) is the authoritative source** for official Maltese air-quality measurements; this is a visualisation of their data, not a replacement for it.

## What it does

A map-first dashboard that answers, in about five seconds:

- What is the air like right now, across both islands?
- Which stations are reporting, and which are stale?
- Which pollutant is driving the current rating?
- Is it safe to go outside, and for whom?
- What is likely to happen over the next couple of days, and why?

Technical measurements are translated into cautious, plain-language guidance. No scientific background is needed to understand whether the air is safe.

Alongside the map: per-station history charts, a 5-day modelled outlook, environmental context (Saharan dust, wind, temperature inversions), optional email alerts, and an optional AI "Explain this" that puts the numbers into words without ever computing them.

## Where the data comes from

Five monitoring stations, all operated by ERA:

| Station       | Island   | Type        | Setting        | Pollutants observed       |
| ------------- | -------- | ----------- | -------------- | ------------------------- |
| Attard        | Malta    | Background  | Urban          | PM2.5, PM10, NO₂, O₃      |
| Msida         | Malta    | **Traffic** | Urban          | PM2.5, PM10, NO₂, SO₂     |
| St Paul's Bay | Malta    | **Traffic** | Urban          | PM2.5, PM10, NO₂, O₃, SO₂ |
| Żejtun        | Malta    | Background  | Urban          | PM2.5, PM10, NO₂, O₃, SO₂ |
| Għarb         | **Gozo** | Background  | Rural-regional | PM2.5, PM10, NO₂, O₃, SO₂ |

Readings reach maqua.app through the **European Environment Agency's** European AQI dissemination layer, which publishes the measurements Malta reports under Directive 2008/50/EC. Data is republished **hourly**, roughly **58 minutes** after the measurement hour.

> [!NOTE]
> **A direct ERA integration was attempted and is not possible from a server.** `era.org.mt` returns HTTP 403 to every non-browser client, including static assets. Rather than invent an endpoint, the ERA provider is a documented stub that refuses to run without a verified URL. The full probe record is in [`docs/DATA_SOURCE.md`](docs/DATA_SOURCE.md).

## Quick start

Everything below assumes a terminal. If you have never used one, the steps are still copy-and-paste — nothing here needs an account, a credit card or an API key.

### 1. Install the prerequisites

You need **Node.js 20 or newer** and **pnpm** (the package manager this project uses instead of npm).

```bash
node --version   # must print v20.x or higher
```

If that command fails or prints an older version, install Node from [nodejs.org](https://nodejs.org/) (pick the LTS download) and run it again.

Then enable pnpm, which ships with Node:

```bash
corepack enable
```

> [!TIP]
> `corepack enable` may need `sudo` on Linux/macOS. If you would rather not use it, `npm install -g pnpm@11.17.0` works just as well.

### 2. Get the code and install dependencies

```bash
git clone https://github.com/MissAIJunkie/malta-air-quality.git
cd malta-air-quality
pnpm install
```

The project pins its own pnpm version, so the first command run inside the folder may ask to download **pnpm 11.17.0**. Answer `y` — that is corepack fetching the right version, not an error. Afterwards:

```bash
pnpm --version   # prints 11.17.0 when run inside this folder
```

### 3. Create your local configuration

```bash
cp .env.example .env.local
```

`.env.example` is fully commented, and **for a first run you do not need to edit anything**. Only two settings have defaults you might eventually want to change: `AIR_QUALITY_PROVIDER` (see step 6) and `NEXT_PUBLIC_APP_URL`, which affects canonical URLs, social preview images and the links inside alert emails — nothing you will see on the local map.

> [!IMPORTANT]
> `.env.local` is git-ignored and is where your own secrets belong. Never put a real key in `.env.example` — that file is committed.

### 4. Run it

```bash
pnpm dev
```

Open <http://localhost:3000>. You should see the map of Malta and Gozo with the five stations plotted and coloured, a headline summary, and a station list. **No credentials are needed**: with no database, no Redis, no AI key and no email key, the app still serves the live map, the station list and the full API.

### 5. Confirm it actually worked

Two checks tell you everything:

```bash
# Which subsystems are on, off or degraded. Returns 200 — read the body, not the code.
curl -s http://localhost:3000/api/health | head -c 600

# Live readings. Look for "source" in the meta block.
curl -s http://localhost:3000/api/air-quality | head -c 600
```

On a fresh checkout with no keys, `/api/health` looks like this:

```jsonc
{
  "status": "ok",
  "airQualityProvider": { "name": "EEA", "status": "ok", "stationsExpected": 5 },
  "reportingStations": 5,
  "database": { "configured": false, "status": "disabled" },
  "cache": { "configured": false, "backend": "in-process", "status": "disabled" },
  "ai": { "configured": false, "status": "disabled" },
  "email": { "configured": false, "status": "disabled" },
}
```

`"status": "ok"` with four subsystems `"disabled"` is the **expected, supported state** — not a failure. Unconfigured is not unhealthy. And `"source": "EEA"` from `/api/air-quality` means you are reading live upstream data.

> [!WARNING]
> If instead you get HTTP 500 and the terminal shows `Invalid environment configuration: …`, one value in your `.env.local` is malformed — a truncated URL, a stray quote. Configuration is validated once at startup and fails loudly rather than half-working. Blank it out and restart; a blank value means "not configured", which is always safe.

### 6. Working offline

To develop with no network at all, replay real captured payloads instead of contacting the EEA:

```bash
AIR_QUALITY_PROVIDER=fixture pnpm dev
```

`meta.source` becomes `"FIXTURE"`. This is also what the end-to-end suite runs against, so `pnpm test:e2e` never touches the network. It is **never** applied as an automatic fallback — a deployment cannot silently start serving canned data.

### Commands

```bash
pnpm dev          # development server
pnpm build        # production build
pnpm start        # serve the production build
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
pnpm test         # unit + component tests (Vitest)
pnpm test:e2e     # end-to-end tests (Playwright)
pnpm format       # Prettier
pnpm db:generate  # generate Drizzle migrations
pnpm db:migrate   # apply migrations
pnpm db:studio    # Drizzle Studio
```

No test contacts ERA, the EEA, OpenRouter, Resend or any weather API.

## Optional services

Every one of these is genuinely optional. The app degrades rather than breaks, and you can add them one at a time later without touching the code.

| Service             | Enables                                 | Without it                                         |
| ------------------- | --------------------------------------- | -------------------------------------------------- |
| **Neon** PostgreSQL | Historical trends, alert subscriptions  | Live readings work; history unavailable            |
| **Upstash** Redis   | Distributed cache, locks, rate limiting | Falls back to a per-instance in-process cache      |
| **OpenRouter**      | AI "Explain this"                       | Deterministic explanation built from measured data |
| **Resend**          | Email alerts                            | Alerts page states it is not enabled               |
| **Sentry**          | Error monitoring                        | Structured console logging only                    |

### Setting them up

Each has a free tier. Add the values to `.env.local`, then restart `pnpm dev`.

<details>
<summary><b>Neon — historical charts and alert subscriptions</b></summary>

1. Create a free project at [neon.tech](https://neon.tech).
2. From the dashboard, copy **both** connection strings — the pooled one and the direct/unpooled one.
3. Put them in `.env.local`:

   ```bash
   DATABASE_URL=postgresql://…-pooler.…/neondb?sslmode=require
   DATABASE_URL_UNPOOLED=postgresql://….neon.tech/neondb?sslmode=require
   ```

4. Create the tables:

   ```bash
   pnpm db:migrate
   ```

Migrations run against the **unpooled** connection — Drizzle DDL must not go through PgBouncer.

</details>

<details>
<summary><b>Upstash — shared cache and rate limiting</b></summary>

1. Create a free Redis database at [upstash.com](https://upstash.com).
2. Copy the **REST** URL and token (not the Redis protocol URL).

   ```bash
   UPSTASH_REDIS_REST_URL=https://….upstash.io
   UPSTASH_REDIS_REST_TOKEN=…
   ```

Locally this changes very little; it matters in production, where serverless instances need a cache they can share.

</details>

<details>
<summary><b>OpenRouter — AI explanations</b></summary>

1. Get a key at [openrouter.ai](https://openrouter.ai/keys).

   ```bash
   OPENROUTER_API_KEY=sk-or-…
   ```

2. The models are configurable because OpenRouter availability changes over time; the defaults in `.env.example` are sensible.

The key is server-only and is never exposed to the browser. Cost controls — rate limit, cache TTL, timeout, circuit breaker — all live in `.env.example` under _AI behaviour_. See [`docs/AI_USAGE.md`](docs/AI_USAGE.md).

</details>

<details>
<summary><b>Resend — email alerts</b></summary>

Alerts need **both** a Resend key and a token secret.

1. Get a key at [resend.com](https://resend.com) and verify a sending domain.
2. Generate a secret for signing confirmation and unsubscribe links:

   ```bash
   openssl rand -hex 32
   ```

   ```bash
   RESEND_API_KEY=re_…
   EMAIL_FROM="maqua.app <alerts@yourdomain>"
   ALERT_TOKEN_SECRET=<the 64-character hex string>
   ```

Without both, the alerts page renders an honest "not enabled on this deployment" state rather than failing.

</details>

<details>
<summary><b>Scheduled jobs</b></summary>

Refresh, forecast, alert-evaluation and cleanup jobs run on a schedule in production (see `vercel.json`). They are gated by a shared secret and return **401** without it, so they are never publicly invocable.

```bash
CRON_SECRET=$(openssl rand -hex 32)
```

They are not needed for local development — requests fetch on demand.

</details>

Full production setup — Vercel, DNS, per-environment variables, rollback — is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## API

These are the routes the app's own front end calls — no key, no session. The browser never talks to an upstream provider; it talks to these.

| Endpoint                        | Purpose                            | Query / body                                                  |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------- |
| `GET /api/air-quality`          | Latest readings + Malta summary    | `station`, `pollutant`                                        |
| `GET /api/stations`             | Station master list with readings  | —                                                             |
| `GET /api/stations/{stationId}` | One station, with history          | `hours` (1–240, default 48), `include=forecast\|observations` |
| `GET /api/forecast`             | Modelled outlook                   | `station`, `pollutant`, `hours` (1–120)                       |
| `GET /api/context`              | Dust, wind, inversions and similar | `type`, `impact`, `limit` (1–50)                              |
| `POST /api/explain`             | Plain-language explanation         | `{ stationId, locale? }`                                      |
| `POST /api/alerts/subscribe`    | Request an email alert             | `{ email, consent: true, alertTypes?, station?, … }`          |
| `GET /api/health`               | Subsystem status                   | —                                                             |

`stationId` accepts either an upstream code (`MT00011`) or a slug (`msida`). Pollutant slugs are `pm25`, `pm10`, `no2`, `o3`, `so2`.

The four data routes — `air-quality`, `stations`, `forecast`, `context` — share one envelope, and every successful response carries a `meta` block:

```jsonc
{
  "data": {/* route-specific */},
  "meta": {
    "source": "EEA", // which provider actually answered
    "measuredAt": "2026-07-26T06:00:00.000Z", // newest observation, UTC
    "fetchedAt": "2026-07-26T07:01:12.004Z", // when maqua.app retrieved it
    "nextExpectedUpdateAt": "2026-07-26T07:58:00.000Z",
    "stale": false, // old, or knowingly cached after a failure
    "partial": false, // a station or pollutant is missing
    "cached": true,
    "degradedReason": "upstream_unavailable", // only when serving last-known-good
  },
}
```

That block is what makes the honesty rules enforceable at the UI layer: a component cannot accidentally describe a reading as live, because `measuredAt`, `fetchedAt` and `stale` all travel with it. Failures return `{ error: { code, message } }` with `cache-control: no-store`.

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

## Scientific accuracy

The European AQI implementation is **verified, not assumed**. An oracle test checks our independent implementation against **615 real observed (concentration, sub-index) pairs** captured from upstream, covering all five pollutants and multiple bands:

```
✓ reproduces the upstream sub-index for every real observation  (0 mismatches)
✓ agrees with the upstream band on every observation            (0 mismatches)
```

That test caught two genuine bugs during development:

1. **Band boundaries are integer-inclusive, not half-open.** The index rounds concentrations to whole µg/m³ first, so PM10 at 15.48 µg/m³ is _Good_ — it rounds to 15. Modelling the bands as half-open real intervals `[15, 45)` classified it as _Fair_. Wrong at every boundary.
2. **Trace negative concentrations are real measurements.** Analysers report values like −0.02 µg/m³ when a pollutant sits below the detection limit. That is clean air, not missing data. Rejecting all negatives discarded valid readings.

Thresholds live in exactly one place, [`src/config/thresholds.ts`](src/config/thresholds.ts). No concentration literals appear in UI components.

Full methodology: [`docs/AQI_METHODOLOGY.md`](docs/AQI_METHODOLOGY.md).

## Principles the code actually enforces

These are tested, not aspirational:

- **A missing value is never zero.** `value === null` renders as _Not available_.
- **Stale data is never called live.** Every reading carries measured-at, retrieved-at, and an age.
- **A forecast is never shown as an observation.** The upstream feed gap-fills _past_ hours too, so the wall clock cannot distinguish them — the `modelled` flag does.
- **Colour is never the only signal.** Every category pairs colour with a text label, an icon and a pattern.
- **AI never computes anything scientific.** It explains; it does not calculate AQI, thresholds, or timestamps. All output is schema-validated and falls back to deterministic prose.
- **One hourly reading never proves an annual legal breach.** Threshold comparisons carry a `conclusive` flag that the UI must respect.

## Limitations

Stated plainly, because a data product that hides its uncertainty is not trustworthy:

- **Five stations for two islands.** Coverage is sparse; Gozo has one rural station. maqua.app therefore shows station readings and deliberately does **not** fabricate a continuous pollution surface or imply street-level precision.
- **Near-real-time data is unverified.** E2a values may be revised or withdrawn. Every reading is labelled provisional.
- **The upstream is not a contractual API.** It is the public backing store for the EEA's own AQI map. Paths could change without notice. Zod validates every payload so a break degrades cleanly rather than corrupting data.
- **Not a direct ERA feed.** Timing and revisions may differ from ERA's own publications. ERA remains authoritative.
- **Forecasts are modelled estimates**, not measurements, and are always labelled as such.
- **English only, for now.** The i18n layer recognises `en`, `mt` and `fr`, but only the English dictionary is complete; the others fall back to English rather than showing half-translated text.

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

## Attribution

> Air-quality data provided by Malta's Environment and Resources Authority (ERA), disseminated via the European Environment Agency (EEA). maqua.app is an independent project and is not operated by, affiliated with, or endorsed by ERA or the EEA.

Map tiles © OpenStreetMap contributors. Weather and atmospheric context from Open-Meteo (CC-BY-4.0). The European Air Quality Index methodology, category names, colours and health advice originate with the EEA.

> [!CAUTION]
> maqua.app provides general environmental information and does not replace medical advice or official emergency guidance.
