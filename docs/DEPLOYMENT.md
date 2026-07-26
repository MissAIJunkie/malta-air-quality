# Deployment — maqua.app on Vercel

**Written:** 2026-07-26 · Target: a production deployment of `maqua.app` on
Vercel, with Neon (PostgreSQL), Upstash (Redis), OpenRouter (AI) and Resend
(email) as **optional** subsystems.

Every one of those four is optional. A deployment with none of them serves the
map, the station list, the Malta summary and the whole API correctly. Steps 3–7
can be skipped and returned to later without touching the code.

> **Honesty note.** Where a step depends on a file that is not yet committed —
> `drizzle.config.ts`, the database schema, `vercel.json`, the cron routes — the
> step says so explicitly and tells you what will happen if you run it anyway.
> A guide that silently fails is worse than no guide.

---

## Before you start

### Prerequisites

```bash
node --version     # ≥ 20
pnpm --version     # 11.17.0 (see "packageManager" in package.json)
git --version
```

Install the Vercel CLI and sign in:

```bash
pnpm add -g vercel
vercel login
```

### Verify locally first, with no credentials at all

This is the fastest way to confirm the checkout is sound before any cloud
resource exists.

```bash
git clone git@github.com:<your-org>/malta-air-quality.git
cd malta-air-quality
pnpm install

cp .env.example .env.local
# Edit .env.local: set AIR_QUALITY_PROVIDER=fixture
#                  set NEXT_PUBLIC_APP_URL=http://localhost:3000
# Leave every other value blank.

pnpm typecheck
pnpm lint
pnpm test
pnpm dev
```

Open <http://localhost:3000> and then check the API directly:

```bash
curl -s 'http://localhost:3000/api/air-quality' | head -c 800
```

You should see `"source":"FIXTURE"` in `meta`. That is the app running with **no
database, no Redis, no AI and no email**, which is the guaranteed baseline.

To smoke-test the live path locally, set `AIR_QUALITY_PROVIDER=eea` and restart.
`meta.source` becomes `"EEA"`.

---

## Step 1 — Create the Vercel project

From the repository root:

```bash
vercel link
```

Answer the prompts:

| Prompt                    | Answer                        |
| ------------------------- | ----------------------------- |
| Set up and deploy?        | `no` (link only for now)      |
| Scope                     | your team or personal account |
| Link to existing project? | `no`                          |
| Project name              | `maqua-app`                   |
| Directory                 | `./`                          |

Vercel detects Next.js and sets the framework preset automatically. Confirm the
build settings, which should require no override:

| Setting          | Value                                          |
| ---------------- | ---------------------------------------------- |
| Framework preset | Next.js                                        |
| Build command    | `pnpm build` (or leave as the Next.js default) |
| Output directory | (default)                                      |
| Install command  | `pnpm install --frozen-lockfile`               |
| Node.js version  | 20.x or 22.x                                   |
| Root directory   | `./`                                           |

`vercel link` writes `.vercel/` locally. Confirm it is git-ignored:

```bash
grep -n '.vercel' .gitignore
```

**Do not set `NODE_ENV` in the Vercel dashboard.** Vercel sets it, and overriding
it breaks Next.js build assumptions. It appears in `.env.example` only for local
use.

---

## Step 2 — Connect the GitHub repository

Connecting through Git rather than deploying only from the CLI is what gives you
preview deployments, per-commit rollback and build checks on pull requests.

1. Vercel dashboard → **Project → Settings → Git → Connect Git Repository**.
2. Select the GitHub repository.
3. Production branch: **`main`**.
4. Enable **Automatically expose System Environment Variables** (this provides
   `VERCEL_URL`, `VERCEL_ENV` and similar).
5. Leave **Deploy Hooks** empty unless you need an external trigger.

From this point every push to `main` builds a production deployment, and every
pull request builds a preview.

Recommended repository protection, so a red build cannot reach production:

```bash
gh api -X PUT repos/<owner>/malta-air-quality/branches/main/protection \
  -F required_status_checks.strict=true \
  -F 'required_status_checks.contexts[]=Vercel' \
  -F enforce_admins=true \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -F restrictions=
```

---

## Step 3 — Neon (PostgreSQL) · OPTIONAL

Enables persisted history beyond the upstream's ~10-day window, alert
subscriptions and stored context events. **Without it the app serves live
readings normally, and short-window history still works** — `getStationHistory()`
reads the provider, and each `current/<CODE>.json` carries roughly ten days of
series. What you lose is history _older_ than that window.

Either use the Vercel integration (Vercel dashboard → **Integrations** → Neon →
**Add Integration** → select the project; it injects `DATABASE_URL` and
`DATABASE_URL_UNPOOLED` automatically), or create the project by hand:

1. <https://console.neon.tech> → **New Project**.
2. Name `maqua-app`, region **AWS eu-central-1** (Frankfurt) — closest to Malta
   of the common Neon regions, and it keeps EU data in the EU.
3. PostgreSQL 17.
4. Copy **both** connection strings from the dashboard.

```bash
# Pooled — used by serverless request handlers.
DATABASE_URL='postgresql://USER:PASSWORD@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require'

# Direct/unpooled — used by migrations. Drizzle DDL must not run through PgBouncer.
DATABASE_URL_UNPOOLED='postgresql://USER:PASSWORD@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require'
```

Verify:

```bash
psql "$DATABASE_URL_UNPOOLED" -c 'select version();'
```

Enable **autoscaling** with a minimum of 0.25 CU and **scale-to-zero** on the
free tier. The first query after an idle period pays a cold start of a second or
two; the read path does not depend on the database, so this is invisible to
visitors.

---

## Step 4 — Drizzle migrations

`drizzle.config.ts` and the schema at `src/db/schema.ts` are committed. The config
reads `.env.local` then `.env`, prefers `DATABASE_URL_UNPOOLED` over
`DATABASE_URL`, and **throws rather than defaulting** when neither is set — a
migration run against the wrong database is far worse than one that refuses to
start. The application itself never loads this file and runs perfectly well with
no database at all.

```bash
# 1. Generate SQL from the TypeScript schema.
pnpm db:generate

# 2. Review the generated SQL before it touches a database. Always.
git diff drizzle/

# 3. Apply against the UNPOOLED connection.
DATABASE_URL_UNPOOLED='postgresql://…' pnpm db:migrate

# 4. Inspect.
pnpm db:studio
```

Rules:

- **Migrations run from a machine or CI job, never from a request handler.** Do
  not add a migration step to the Vercel build command: builds run concurrently
  across regions and would race.
- **Migrate against `DATABASE_URL_UNPOOLED`.** PgBouncer in transaction pooling
  mode cannot run the session-level statements DDL needs.
- **Additive first.** Add a nullable column, deploy, backfill, then tighten. A
  migration that drops or renames in the same deploy as the code change will fail
  on the old instances still serving traffic.
- Migrate **before** promoting the deployment that needs the new shape.

---

## Step 5 — Upstash Redis · OPTIONAL

Enables distributed caching, cross-instance request deduplication, the locks used
by scheduled jobs, and Redis-backed rate limiting.

**Without it the app falls back to a per-instance in-process `Map`.** That is
correct but not shared: each warm serverless instance keeps its own copy, so
upstream request volume rises roughly with the number of warm instances. Locks
degrade to running the function without coordination.

Vercel dashboard → **Storage → Create Database → Upstash Redis**, or:

1. <https://console.upstash.com> → **Create Database**.
2. Name `maqua-app-cache`, type **Regional**, region **eu-central-1**.
3. Enable **TLS**. Eviction: `allkeys-lru`.
4. Copy the **REST** URL and token — this project uses `@upstash/redis` over
   REST, not the TCP protocol.

```bash
UPSTASH_REDIS_REST_URL='https://xxx.upstash.io'
UPSTASH_REDIS_REST_TOKEN='AX...'
```

Verify:

```bash
curl -s "$UPSTASH_REDIS_REST_URL/ping" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
# {"result":"PONG"}
```

Both variables must be present. `getCapabilities().redis` is
`Boolean(URL && TOKEN)` — one without the other leaves Redis disabled.

**Sizing.** With `cachePolicy.latestReadings` at a 900-second TTL, upstream is
queried at most about four times an hour regardless of traffic. Cached payloads
are a few hundred kilobytes in total. The Upstash free tier is ample.

---

## Step 6 — OpenRouter · OPTIONAL

Enables model-written explanations and context summaries. Without it, "Explain
this" returns deterministic, non-AI text built from the measured data — the app
does not lose a feature, it loses the prose. See `docs/AI_USAGE.md` for the full
policy.

1. <https://openrouter.ai/keys> → **Create Key**.
2. Name it `maqua-app-production`.
3. **Set a hard credit limit.** This is the only real cost-control backstop.
4. Copy the key — it is shown once.

```bash
OPENROUTER_API_KEY='sk-or-v1-…'
OPENROUTER_MODEL='openai/gpt-4.1-mini'
OPENROUTER_FALLBACK_MODEL='google/gemini-2.5-flash'
OPENROUTER_SITE_URL='https://maqua.app'
OPENROUTER_APP_NAME='maqua.app'
```

**Models are configuration, never code.** OpenRouter's catalogue and pricing
change; both the primary and the fallback are environment variables so a model
can be swapped without a deploy. The values above are the shipped defaults in
`src/config/openrouter.ts` — the single file in which any model identifier is
permitted to appear — so setting neither variable still works. Check current
availability and pricing at <https://openrouter.ai/models> before overriding.

The key is server-only, read exclusively inside
`src/lib/ai/openrouter-client.ts`, and never exposed to the browser.
`openrouter.ai` is already on the outbound allowlist in
`src/lib/security/allowlist.ts`.

Verify:

```bash
curl -s https://openrouter.ai/api/v1/auth/key \
  -H "Authorization: Bearer $OPENROUTER_API_KEY"
```

Cost controls, all environment-driven:

```bash
AI_EXPLANATIONS_ENABLED=true
AI_CONTEXT_SUMMARIES_ENABLED=true
AI_MAX_REQUESTS_PER_MINUTE=30
AI_CACHE_TTL_SECONDS=3600
AI_REQUEST_TIMEOUT_MS=15000
```

To disable AI entirely on a deployment without removing the key, set
`AI_EXPLANATIONS_ENABLED=false` and `AI_CONTEXT_SUMMARIES_ENABLED=false`.

---

## Step 7 — Resend and domain verification · OPTIONAL

Enables email alerts. Alerts require **both** `RESEND_API_KEY` **and**
`ALERT_TOKEN_SECRET` — `getCapabilities().email` is the conjunction of the two,
because an alert a recipient cannot unsubscribe from must never be sent.

1. <https://resend.com/domains> → **Add Domain** → `maqua.app`.
2. Resend issues three DNS records. Add them at your registrar:

| Type  | Name                          | Value                                                 | Purpose         |
| ----- | ----------------------------- | ----------------------------------------------------- | --------------- |
| `TXT` | `send.maqua.app`              | `v=spf1 include:amazonses.com ~all`                   | SPF             |
| `TXT` | `resend._domainkey.maqua.app` | (long public key from Resend)                         | DKIM            |
| `MX`  | `send.maqua.app`              | `feedback-smtp.eu-west-1.amazonses.com` priority `10` | Bounce handling |

3. Add a DMARC record yourself — Resend does not create one:

| Type  | Name               | Value                                          |
| ----- | ------------------ | ---------------------------------------------- |
| `TXT` | `_dmarc.maqua.app` | `v=DMARC1; p=none; rua=mailto:dmarc@maqua.app` |

Start at `p=none`, watch the aggregate reports for a fortnight, then tighten to
`p=quarantine`.

4. Wait for verification (usually minutes; DNS propagation can take up to 48
   hours) and confirm:

```bash
dig +short TXT resend._domainkey.maqua.app
dig +short TXT _dmarc.maqua.app
dig +short MX  send.maqua.app
```

5. Create an API key at <https://resend.com/api-keys> with **Sending access**
   only, restricted to `maqua.app`.

```bash
RESEND_API_KEY='re_…'
EMAIL_FROM='maqua.app <alerts@maqua.app>'
EMAIL_REPLY_TO='hello@maqua.app'
ALERT_TOKEN_SECRET="$(openssl rand -hex 32)"
```

`ALERT_TOKEN_SECRET` signs confirmation and unsubscribe tokens with HMAC-SHA256.
**Rotating it invalidates every outstanding unsubscribe link**, so rotate only
deliberately.

---

## Step 8 — Environment variables

Set them from the CLI (repeat per environment) or paste them in the dashboard
under **Settings → Environment Variables**.

```bash
vercel env add AIR_QUALITY_PROVIDER production
vercel env add UPSTASH_REDIS_REST_URL production
# …and so on

# Bulk-import a local file into preview, if you prefer:
vercel env pull .env.production.local   # verify what is currently set
```

### Full reference

Parsed and validated by `src/config/env.ts`. **No variable is strictly required:**
every field in the schema has a default or is `.optional()`, so `getEnv()` cannot
fail on a fresh deployment — it throws only when a _supplied_ value is malformed,
for example a non-URL `NEXT_PUBLIC_APP_URL`. "Required in production" below means
_required for correct behaviour_, not _required to boot_.

| Variable                       | Required?                           | Default                                                                                      | Effect if unset                                                                                                                   |
| ------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`          | Required in production              | `https://maqua.app`                                                                          | Canonical URLs, Open Graph and email links point at the wrong host.                                                               |
| `NODE_ENV`                     | Set by Vercel — **do not override** | `development`                                                                                | —                                                                                                                                 |
| `AIR_QUALITY_PROVIDER`         | Recommended                         | `eea`                                                                                        | Defaults to the verified live source. Set `fixture` only for previews you want fully deterministic.                               |
| `EEA_AIR_QUALITY_URL`          | Optional                            | the verified dissemination base URL                                                          | Change only if the EEA moves the layer. Validated against the outbound host allowlist.                                            |
| `ERA_AIR_QUALITY_URL`          | Optional                            | (unset)                                                                                      | **Leave empty.** No ERA endpoint has ever been observed (`docs/DATA_SOURCE.md` §2). The `era` provider refuses to run without it. |
| `DATABASE_URL`                 | Optional                            | (unset)                                                                                      | No stored history, no alert subscriptions, no stored context events. Live readings and short-window history still work.           |
| `DATABASE_URL_UNPOOLED`        | Optional                            | (unset)                                                                                      | Migrations cannot run.                                                                                                            |
| `UPSTASH_REDIS_REST_URL`       | Optional                            | (unset)                                                                                      | Falls back to a per-instance in-process cache.                                                                                    |
| `UPSTASH_REDIS_REST_TOKEN`     | Optional                            | (unset)                                                                                      | As above. Both are needed for Redis to be enabled.                                                                                |
| `OPENROUTER_API_KEY`           | Optional                            | (unset)                                                                                      | AI explanations fall back to deterministic text.                                                                                  |
| `OPENROUTER_MODEL`             | Optional                            | unset in the schema; falls back to `OPENROUTER_DEFAULTS.model` in `src/config/openrouter.ts` | The shipped default model is used.                                                                                                |
| `OPENROUTER_FALLBACK_MODEL`    | Optional                            | unset in the schema; falls back to `OPENROUTER_DEFAULTS.fallbackModel`                       | The shipped fallback model is used.                                                                                               |
| `OPENROUTER_SITE_URL`          | Optional                            | `https://maqua.app`                                                                          | Sent as OpenRouter attribution headers.                                                                                           |
| `OPENROUTER_APP_NAME`          | Optional                            | `maqua.app`                                                                                  | As above.                                                                                                                         |
| `AI_EXPLANATIONS_ENABLED`      | Optional                            | `true`                                                                                       | Kill switch for AI explanations.                                                                                                  |
| `AI_CONTEXT_SUMMARIES_ENABLED` | Optional                            | `true`                                                                                       | Kill switch for AI context summaries.                                                                                             |
| `AI_MAX_REQUESTS_PER_MINUTE`   | Optional                            | `30`                                                                                         | Rate limit for AI endpoints.                                                                                                      |
| `AI_CACHE_TTL_SECONDS`         | Optional                            | `3600`                                                                                       | How long a generated explanation is reused.                                                                                       |
| `AI_REQUEST_TIMEOUT_MS`        | Optional                            | `15000`                                                                                      | Budget for the **whole** AI operation — retries and fallback model included, not per attempt.                                     |
| `WEATHER_PROVIDER`             | Optional                            | `open-meteo`                                                                                 | `none` disables all environmental context. See `docs/CONTEXT_SOURCES.md`.                                                         |
| `CONTEXT_REFRESH_ENABLED`      | Optional                            | `true`                                                                                       | Disables scheduled context refresh.                                                                                               |
| `RESEND_API_KEY`               | Optional                            | (unset)                                                                                      | Email alerts disabled.                                                                                                            |
| `EMAIL_FROM`                   | Optional                            | `maqua.app <alerts@maqua.app>`                                                               | Must be on a Resend-verified domain.                                                                                              |
| `EMAIL_REPLY_TO`               | Optional                            | (unset)                                                                                      | Replies go nowhere useful.                                                                                                        |
| `ALERT_TOKEN_SECRET`           | Required **if** alerts are enabled  | (unset)                                                                                      | Alerts stay disabled — unsubscribe tokens cannot be signed. `openssl rand -hex 32`.                                               |
| `CRON_SECRET`                  | Required **if** cron is used        | (unset)                                                                                      | Cron routes return 401, so scheduled work never runs. `openssl rand -hex 32`.                                                     |
| `SENTRY_DSN`                   | Optional                            | (unset)                                                                                      | No error aggregation; structured logs still reach the log drain.                                                                  |

Three variables appear in `.env.example` but are **not** in the Zod schema, so
they are read directly from `process.env` by client-side code rather than through
`getEnv()`: `NEXT_PUBLIC_SENTRY_DSN`,
`NEXT_PUBLIC_VERCEL_ANALYTICS_ENABLED`,
`NEXT_PUBLIC_VERCEL_SPEED_INSIGHTS_ENABLED`. Anything prefixed `NEXT_PUBLIC_` is
inlined into the browser bundle — **never put a secret behind that prefix.**

### Per-environment guidance

|                        | Production          | Preview                                         | Development             |
| ---------------------- | ------------------- | ----------------------------------------------- | ----------------------- |
| `AIR_QUALITY_PROVIDER` | `eea`               | `eea`, or `fixture` for deterministic UI review | `fixture`               |
| `NEXT_PUBLIC_APP_URL`  | `https://maqua.app` | leave unset; use `VERCEL_URL`                   | `http://localhost:3000` |
| `DATABASE_URL`         | production branch   | a Neon **branch**, never production             | local or unset          |
| `CRON_SECRET`          | set                 | unset (previews should not run cron)            | unset                   |
| `RESEND_API_KEY`       | set                 | **unset** — previews must not send real email   | unset                   |

---

## Step 9 — DNS for maqua.app

Vercel dashboard → **Project → Settings → Domains → Add** → `maqua.app`. Add
`www.maqua.app` as well and set it to redirect to the apex.

At the registrar:

| Type    | Name  | Value                   | TTL  |
| ------- | ----- | ----------------------- | ---- |
| `A`     | `@`   | `76.76.21.21`           | 3600 |
| `CNAME` | `www` | `cname.vercel-dns.com.` | 3600 |

If your registrar supports `ALIAS`/`ANAME` at the apex, prefer
`ALIAS @ → cname.vercel-dns.com.` over the `A` record — it follows Vercel's
anycast changes automatically. Confirm the current target in the dashboard rather
than trusting the address above indefinitely.

Verify:

```bash
dig +short maqua.app
dig +short www.maqua.app
curl -sI https://maqua.app | head -n 1
```

Vercel provisions the TLS certificate automatically once the records resolve —
usually within minutes. Then:

- Enable **HSTS** in the domain settings once you are confident (it is hard to
  undo; browsers cache the policy).
- Set the **production domain** to `maqua.app` so canonical URLs and Open Graph
  tags use it.
- Keep the Resend records from Step 7 on the same zone. They are independent of
  the Vercel records and must not be replaced.

---

## Step 10 — Preview deployments

Every pull request gets its own URL. Use them for review, not just for smoke
tests.

```bash
git checkout -b feature/station-detail
git push -u origin feature/station-detail
gh pr create --fill
```

Or deploy an unlinked preview from the CLI:

```bash
vercel                # preview
vercel --prod         # production (see Step 11)
```

Guidance:

- Point previews at a **Neon branch**, never the production database. Create one
  per pull request in the Neon console, or via the Vercel–Neon integration's
  automatic branching.
- Leave `RESEND_API_KEY` unset in preview. A preview that sends real email to
  real subscribers is a bug, not a test.
- Leave `CRON_SECRET` unset in preview so scheduled routes stay inert.
- Set `AIR_QUALITY_PROVIDER=fixture` on previews where you want visual review to
  be reproducible; the fixture provider replays a real captured payload with
  timestamps rebased onto the current hour, so the page looks live without
  depending on what Malta's air is doing today.
- Enable **Vercel Deployment Protection** on previews if the project is not
  public.

Check a preview from the command line:

```bash
curl -s 'https://<preview-url>/api/air-quality' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["meta"])'
```

---

## Step 11 — Production deploy

The normal path is a merge to `main`. Vercel builds and promotes automatically.

```bash
gh pr merge --squash
vercel inspect --wait          # follow the build
```

To promote an existing preview build instead of rebuilding — faster, and it
guarantees you ship the exact artefact you reviewed:

```bash
vercel promote <deployment-url>
```

To deploy from the CLI directly:

```bash
vercel --prod
```

### Post-deploy checklist

```bash
# 1. The API answers, and reports which provider served it.
curl -s https://maqua.app/api/air-quality \
  | python3 -c 'import json,sys; m=json.load(sys.stdin)["meta"]; print(m["source"], m["measuredAt"], m["stale"], m["cached"])'

# 2. The page renders.
curl -sI https://maqua.app | head -n 1

# 3. Security headers and cache-control are as expected.
curl -sI https://maqua.app/api/air-quality | grep -i 'cache-control'
# expect: public, s-maxage=300, stale-while-revalidate=3600
```

Expect `source` to be `EEA`, `measuredAt` within about two hours of now, and
`stale` to be `false`. If `source` is `FIXTURE` in production, the environment
variable is wrong — fix it before anything else.

> A `/api/health` endpoint reporting `getCapabilities()` is referenced in
> `src/config/env.ts` and `.env.example` but is **not committed yet**. Until it
> lands, use `/api/air-quality`'s `meta` block as the health signal.

---

## Step 12 — Cron configuration

> **Status as of 2026-07-26:** `vercel.json` is **not committed**, and neither are
> the `/api/cron/*` routes. The configuration below is the target shape. Adding
> the `crons` block before the routes exist produces scheduled invocations that
> 404 — add both together.

Create `vercel.json` at the repository root:

```json
{
  "crons": [
    { "path": "/api/cron/refresh-air-quality", "schedule": "5 * * * *" },
    { "path": "/api/cron/refresh-context", "schedule": "15 */3 * * *" },
    { "path": "/api/cron/evaluate-alerts", "schedule": "20 * * * *" }
  ]
}
```

**Why five minutes past the hour.** The upstream publishes hourly with a measured
~58-minute lag (`docs/DATA_SOURCE.md` §6). Running at `:05` means the newest
observed hour is reliably available. Running at `:00` would race the publication
and refresh nothing.

**Authentication.** Vercel sends `Authorization: Bearer $CRON_SECRET` on every
cron invocation. Each route must compare against `CRON_SECRET` in constant time
and return `401` on mismatch, using `unauthorized()` from
`src/lib/api/respond.ts`. With `CRON_SECRET` unset, `getCapabilities().cron` is
`false` and the routes must refuse everything — that is what stops them being
publicly invocable.

**Concurrency.** Every cron handler must wrap its work in `withLock()` using the
corresponding key from `cacheKeys` — `lockRefreshAirQuality`,
`lockRefreshContext`, `lockEvaluateAlerts`. This is the genuinely distributed
lock (Redis `SET NX EX`); it is what stops two overlapping invocations both
writing history or both sending the same alert. Without Redis, `withLock()` runs
the function anyway rather than stalling the job, so on a Redis-less deployment
concurrency is unguarded — an argument for provisioning Upstash before enabling
cron.

Test manually once deployed:

```bash
curl -s -X GET https://maqua.app/api/cron/refresh-air-quality \
  -H "Authorization: Bearer $CRON_SECRET" -i | head -n 20

# And confirm it refuses without the secret:
curl -s -o /dev/null -w '%{http_code}\n' https://maqua.app/api/cron/refresh-air-quality
# expect: 401
```

Cron runs only on **production** deployments. Hobby-plan accounts are limited to
daily schedules; the hourly schedules above need a Pro plan.

---

## Step 13 — Cache behaviour in production

Three layers, with different numbers. Knowing which one you are looking at saves
a lot of confusion.

| Layer             | Where                                    | Setting                                                                                                                     | What it controls                                           |
| ----------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Vercel edge / CDN | `respond.ok()`                           | `public, s-maxage=300, stale-while-revalidate=3600`                                                                         | How often a request reaches your function. Absorbs bursts. |
| Redis (Upstash)   | `cachePolicy` in `src/lib/cache/keys.ts` | `latestReadings` 900 s TTL + 7200 s SWR; `stations` 21 600 + 86 400; `stationHistory` 1800 + 7200; `forecast` 3600 + 10 800 | How often **upstream** is queried.                         |
| In-process `Map`  | `src/lib/cache/upstash.ts`               | same TTLs                                                                                                                   | Fallback when Redis is absent or failing. Per instance.    |

Consequences worth internalising before you debug anything:

- **A deploy does not clear Redis.** Cached readings survive it. To force a
  refresh, either wait out the 900-second TTL, delete the key, or bump `VERSION`
  in `src/lib/cache/keys.ts` (which invalidates every key of that class):

  ```bash
  curl -s -X POST "$UPSTASH_REDIS_REST_URL/del/v1:aq:latest:EEA" \
    -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
  ```

- **Error responses are never cached** — every non-200 helper sets
  `cache-control: no-store`.
- **Upstream is polled at most about four times an hour** regardless of traffic.
  If you see more than that in the logs, something is bypassing the service
  layer.
- **`meta.cached` and `meta.stale` are your instrumentation.** `cached: true,
stale: false` is a healthy cache hit. `stale: true` with
  `degradedReason: 'upstream_unavailable'` means last-known-good is being served
  and the UI is labelling it accordingly.
- Purge the edge cache from **Vercel dashboard → Project → Settings → Data Cache
  → Purge Everything** if you need to. It does not touch Redis.

---

## Step 14 — Monitoring and rollback

### Logs

Every log line is a single JSON object (`src/lib/monitoring/logger.ts`), so
Vercel's log drain can be queried by field. Fields whose key matches
`/(key|token|secret|password|authorization|cookie|dsn|credential)/i` are redacted
before emission, and strings over 500 characters are truncated.

```bash
vercel logs https://maqua.app --follow
vercel logs https://maqua.app --since 1h | grep '"level":"error"'
```

Events worth alerting on:

| Event                               | Meaning                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `upstream.station_fetch_failed`     | One station's payload could not be fetched. Occasional is normal; persistent is not. |
| `upstream.no_measured_values`       | A station returned a payload with no measured hour at all.                           |
| `upstream.unparseable_hours`        | Hour keys failed validation — a possible upstream shape change.                      |
| `cache.serving_stale`               | Upstream failed and last-known-good is being served.                                 |
| `cache.miss_and_upstream_failed`    | Nothing cached **and** upstream failed. Visitors see an error. Page this.            |
| `stations.unknown_upstream_station` | A new operational `MT*` station appeared. Needs a reviewed commit.                   |
| `stations.coordinate_drift`         | Configured coordinates diverge from upstream by > `1e-4`.                            |
| `api.route_error`                   | An unhandled route error.                                                            |

### Sentry

Set `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (browser). Both are
optional; without them structured logs still reach the log drain.
`getCapabilities().monitoring` reflects the server DSN only.

### Analytics

`@vercel/analytics` and `@vercel/speed-insights` are installed. Enable them in
the dashboard under **Analytics** and **Speed Insights**.

### Uptime checks

Point an external monitor at `https://maqua.app/api/air-quality` and assert on
the body, not just the status code — a 200 carrying `"stale": true` for hours is
the failure mode that a status-only check misses:

```bash
curl -s https://maqua.app/api/air-quality \
  | python3 -c 'import json,sys; m=json.load(sys.stdin)["meta"]; sys.exit(0 if not m["stale"] else 1)'
```

### Rollback

Vercel keeps every deployment as an immutable artefact.

```bash
vercel ls maqua-app                 # list recent deployments
vercel rollback <deployment-url>    # instantly repoint production
```

Or in the dashboard: **Deployments → (older, healthy build) → ⋯ → Promote to
Production**. Promotion is near-instant because the artefact already exists.

Three things a rollback does **not** undo, and they decide whether rolling back
is safe:

1. **Database migrations.** Roll the code back and the old code meets the new
   schema. This is precisely why Step 4 insists on additive-first migrations.
2. **Redis contents.** Cached values written by the new code survive. If the
   rollback is because of a shape change, delete the affected keys or bump
   `VERSION`.
3. **Email already sent.** Nothing recalls it.

After any rollback, re-run the Step 11 post-deploy checklist.

---

## Step 15 — Provider troubleshooting

### `meta.source` is `FIXTURE` in production

`AIR_QUALITY_PROVIDER` is set to `fixture`. Fix the environment variable and
redeploy. Fixture data is deterministic replay and must never be shown as
production data — this is why `meta.source` exists.

```bash
vercel env ls production | grep AIR_QUALITY_PROVIDER
```

### `EraProviderNotConfiguredError`

`AIR_QUALITY_PROVIDER=era` without a verified `ERA_AIR_QUALITY_URL`. This is
working as designed. `era.org.mt` returns HTTP 403 behind Cloudflare to every
non-browser client, so **no ERA endpoint has ever been observed and none has been
invented** (`docs/DATA_SOURCE.md` §2). Set `AIR_QUALITY_PROVIDER=eea` — ERA's
measurements reach the app through the EEA dissemination layer either way.

### `Refusing to contact non-allowlisted host: …`

`assertAllowedUrl()` rejected the URL. Causes, in order of likelihood: a typo in
`EEA_AIR_QUALITY_URL`; an `http://` scheme; credentials embedded in the URL; or a
genuinely new host that needs adding to `ALLOWED_UPSTREAM_HOSTS` in
`src/lib/security/allowlist.ts`. Host matching is exact, not suffix-based, and
that is deliberate. Adding a host is a reviewed code change, never a
configuration change.

### `upstream responded 404` on the station master list

The stamped filename in `content/raw_stations.json.<stamp>` changed. The code
already handles this — `resolveStationListUrl()` reads
`content/index.json` on every call and never hardcodes the stamp. A persistent
404 means the layer itself moved. Reproduce by hand:

```bash
S='https://dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans/'
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
curl -sS -A "$UA" "${S}content/index.json"
curl -sS -A "$UA" "${S}current/MT00011.json" | head -c 500
```

Note that station metadata failing is **not** fatal: `getStations()` catches it,
logs `stations.metadata_unavailable` and returns the reviewed list from
`src/config/stations.ts`.

### Zod validation errors from the upstream payload

The dissemination layer is a public backing store, not a contractual API. A shape
change surfaces as a clean validation failure by design. The schemas in
`src/lib/air-quality/schemas.ts` are permissive about _extra_ fields and strict
about the ones actually read, so a new upstream column does not break anything —
a renamed or retyped one does. Compare a live payload against
`fixtures/upstream-station-sample.json` and update the schema.

### Readings are stale but upstream is healthy

Check the ordering in `meta`: `stale` is true when the _data_ is old **or** when a
cached copy is being served after an upstream failure. If `degradedReason` is
absent, the data itself is genuinely old — the upstream has not republished. If
`degradedReason: 'upstream_unavailable'` is present, fetches are failing and
last-known-good is being served. Only the second case is a maqua.app problem.

### One station missing from the response

`meta.partial` is `true` and `upstream.station_fetch_failed` appears in the logs.
Fetches run under `Promise.allSettled`, so one station failing does not blank the
others. If a station is _persistently_ absent, check whether it has gone
non-operational upstream — `getStations()` reflects `operational` in the `active`
flag, and `stations.unknown_upstream_station` would fire if the network changed.

### Everything works locally but not on Vercel

In order: check that the environment variable exists in the **right environment**
(`vercel env ls production`); check that a malformed value is not making
`getEnv()` throw at boot (the error names the offending field); check the
function region — for a Malta-facing app, `fra1` or `cdg1` — and check the Node
version matches the one you tested with.
