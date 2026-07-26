# Contributing to maqua.app

Thank you for considering a contribution. maqua.app publishes health-relevant environmental information, so the bar for data handling is higher than for a typical web app. Most of this document is about that.

---

## Getting set up

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

No credentials are required. For work that should never touch the network:

```bash
AIR_QUALITY_PROVIDER=fixture pnpm dev
```

Before opening a pull request:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

---

## The rules that are not negotiable

These exist because getting them wrong misleads people about whether the air is safe to breathe. A change that violates one of these will not be merged, however well written.

### Never invent data

- **No invented endpoints.** If you cannot reach a source, document the failure — do not write a plausible-looking URL. `src/lib/air-quality/providers/era-provider.ts` is the worked example: it carries the probe evidence and refuses to run rather than pretending.
- **No invented stations or coordinates.** Station geometry comes from the upstream master list and is reviewed in version control. If a new station appears upstream, the provider logs it; adopting it is a deliberate commit.
- **No invented forecast values.** The outlook surfaces official CAMS-modelled values already present in the feed. A language model may explain a forecast; it may never produce one.

### Never render a missing value as zero

`value === null` means _not measured_. It is not clean air. Showing `0 µg/m³` for a broken analyser tells someone the air is perfect when we simply do not know.

Anything that could produce a number for a missing reading needs a test proving it does not.

### Never call stale data live

Every reading carries `measuredAt`, `fetchedAt`, `freshness` and `ageHours`. If freshness is anything other than `fresh`, the UI must say so with an exact age.

### Never present a forecast as an observation

The upstream feed gap-fills **past** hours as well as forecasting future ones, so `timestamp > now` is not a valid test. Use the `modelled` flag and `latestObservedTimestamp()`.

### Never rely on colour alone

Every category renders colour **plus** a text label, an icon and a pattern. `CATEGORY_PRESENTATION` carries all four. This is a WCAG 2.2 AA requirement and a safety one.

### Never let AI compute anything scientific

AI explains. It does not calculate AQI, evaluate thresholds, parse timestamps, or produce values. All model output is schema-validated, citation-checked against supplied source ids, and falls back to deterministic prose on any failure.

### Never confuse a legal limit with a health warning

`compareToThresholds()` returns a `conclusive` flag. Most EU limit values use long averaging periods with permitted annual exceedances, so a single hourly reading **cannot** establish a breach. Phrase those as observations about one hour.

---

## Where things live

| Concern                              | Location                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| Thresholds, categories, legal limits | `src/config/thresholds.ts` — **the only place** concentration numbers may appear |
| Stations                             | `src/config/stations.ts`                                                         |
| Pollutants                           | `src/config/pollutants.ts`                                                       |
| AQI maths                            | `src/lib/air-quality/calculate-index.ts`                                         |
| Freshness                            | `src/lib/air-quality/freshness.ts`                                               |
| Providers                            | `src/lib/air-quality/providers/`                                                 |
| User-facing strings                  | `src/lib/i18n/dictionary.ts`                                                     |

**No concentration literal belongs in a component.** If you find yourself typing `45` next to `PM10` in JSX, the number belongs in the threshold config and the component should be asking `calculateCategory()`.

---

## Testing expectations

- **Deterministic logic needs unit tests.** Anything in `calculate-index.ts`, `freshness.ts`, classification, deduplication or alert evaluation.
- **No test may contact a live service.** Not ERA, the EEA, OpenRouter, Resend or any weather API. Mock `fetch`.
- **Changing a threshold means changing the oracle test.** `src/lib/air-quality/__tests__/calculate-index.test.ts` validates our implementation against 6,760 real captured upstream pairs. If your change makes it fail, the change is probably wrong — that test has already caught two real bugs. Investigate before adjusting expectations.

Adding a pollutant means touching `pollutants.ts`, `thresholds.ts`, the i18n dictionary, and the provider mapping — plus tests for the new breakpoints.

---

## Code style

- TypeScript strict. No `any` without a comment explaining why.
- Prettier and ESLint are enforced; run `pnpm format`.
- Server components by default; `'use client'` only where interactivity genuinely requires it.
- **Comments explain why, not what.** Favour them where a subtlety would otherwise look like a mistake — the integer-inclusive band boundaries are the canonical example. Skip decorative comments entirely.
- British spelling in user-facing copy. Maltese place names keep their diacritics: Għarb, Żejtun, San Pawl il-Baħar.

---

## Accessibility

Target is **WCAG 2.2 AA**, and the map is not exempt: the station list is a genuine equivalent, not a consolation prize. Check keyboard navigation, visible focus, 44px touch targets, reduced motion, and that every chart has a text alternative.

---

## Reporting a data problem

If a reading looks wrong, please include the station, the timestamp, what maqua.app showed, and what you expected.

Please also check ERA's own publication first. **ERA is authoritative**; maqua.app may lag, or may be surfacing provisional data that was later revised. That is a useful bug report either way, but it changes the diagnosis.

---

## Security

Please report security issues privately rather than opening a public issue.

Particularly relevant here: the outbound allowlist in `src/lib/security/allowlist.ts` uses **exact** host matching — never relax it to suffix matching, because `evil-dis2datalake.blob.core.windows.net` would pass. There is a test for exactly that.
