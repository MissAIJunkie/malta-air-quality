/**
 * Operational telemetry: upstream reachability and ingestion runs.
 *
 * This exists so `/api/health` can report a TREND rather than one lucky probe.
 * The upstream is a public backing store, not a contractual API — knowing that
 * it has failed four of the last twenty checks is the difference between "our
 * data looks odd today" and "the source has been down since Tuesday".
 *
 * Nothing here is on a user-facing critical path, so every function degrades to
 * a neutral value when there is no database.
 */

import { and, avg, count, desc, eq, gte, lte, sql } from 'drizzle-orm';

import { logger } from '@/lib/monitoring/logger';
import { withDb } from '../client';
import { retentionCutoff } from '../retention';
import {
  dataImportRuns,
  providerHealth,
  type DataImportRunRow,
  type ProviderHealthRow,
} from '../schema';

export type ProviderProbe = {
  provider: string;
  ok: boolean;
  statusCode?: number | null;
  latencyMs?: number | null;
  /** Message only. Never a URL carrying a token, never a response body. */
  error?: string | null;
  detail?: Record<string, unknown> | null;
};

/** Record one reachability probe. Fire-and-forget: a failure to log a failure
 *  must not itself become an error. */
export async function recordProviderProbe(
  probe: ProviderProbe,
  now: Date = new Date(),
): Promise<void> {
  await withDb('health.recordProbe', undefined, async (db) => {
    await db.insert(providerHealth).values({
      provider: probe.provider,
      checkedAt: now,
      ok: probe.ok,
      statusCode: probe.statusCode ?? null,
      latencyMs: probe.latencyMs ?? null,
      error: probe.error ?? null,
      detail: probe.detail ?? null,
    });
  });
}

export type ProviderHealthSummary = {
  provider: string;
  /** Number of probes in the window. `0` means "we have no record", which is
   *  NOT the same as "the provider is down" and must not be rendered as such. */
  samples: number;
  successes: number;
  /** `null` when there are no samples — never 0, which would read as "0% uptime". */
  successRate: number | null;
  averageLatencyMs: number | null;
  lastCheckedAt: Date | null;
  lastOk: boolean | null;
};

/**
 * Summarise recent probes for one provider.
 *
 * `successRate` is `null` rather than `0` when nothing has been recorded. The
 * distinction is the same one the whole application makes about missing
 * measurements: absence of data is not a measurement of zero.
 */
export async function summariseProviderHealth(
  provider: string,
  windowHours = 24,
  now: Date = new Date(),
): Promise<ProviderHealthSummary> {
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const empty: ProviderHealthSummary = {
    provider,
    samples: 0,
    successes: 0,
    successRate: null,
    averageLatencyMs: null,
    lastCheckedAt: null,
    lastOk: null,
  };

  return withDb('health.summarise', empty, async (db) => {
    const aggregate = await db
      .select({
        samples: count(),
        successes: sql<number>`count(*) filter (where ${providerHealth.ok})`.mapWith(Number),
        averageLatencyMs: avg(providerHealth.latencyMs),
      })
      .from(providerHealth)
      .where(and(eq(providerHealth.provider, provider), gte(providerHealth.checkedAt, since)));

    const latest = await db
      .select({ checkedAt: providerHealth.checkedAt, ok: providerHealth.ok })
      .from(providerHealth)
      .where(eq(providerHealth.provider, provider))
      .orderBy(desc(providerHealth.checkedAt))
      .limit(1);

    const row = aggregate[0];
    const samples = row?.samples ?? 0;
    if (samples === 0) {
      return {
        ...empty,
        lastCheckedAt: latest[0]?.checkedAt ?? null,
        lastOk: latest[0]?.ok ?? null,
      };
    }

    const successes = row?.successes ?? 0;
    const avgLatency = row?.averageLatencyMs;

    return {
      provider,
      samples,
      successes,
      successRate: successes / samples,
      averageLatencyMs: avgLatency === null || avgLatency === undefined ? null : Number(avgLatency),
      lastCheckedAt: latest[0]?.checkedAt ?? null,
      lastOk: latest[0]?.ok ?? null,
    };
  });
}

/** Raw recent probes, newest first — for an operator-facing view. */
export async function listRecentProbes(provider: string, limit = 50): Promise<ProviderHealthRow[]> {
  return withDb('health.listRecent', [] as ProviderHealthRow[], (db) =>
    db
      .select()
      .from(providerHealth)
      .where(eq(providerHealth.provider, provider))
      .orderBy(desc(providerHealth.checkedAt))
      .limit(Math.min(limit, 500)),
  );
}

/* -------------------------------------------------------------------------- */
/*  Import runs                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Open an ingestion run.
 *
 * @returns the run id, or `null` with no database — callers must treat `null` as
 *          "carry on without an audit trail", not as a reason to abort ingestion.
 */
export async function startImportRun(
  job: string,
  source: string | null = null,
  now: Date = new Date(),
): Promise<string | null> {
  return withDb('health.startImportRun', null as string | null, async (db) => {
    const rows = await db
      .insert(dataImportRuns)
      .values({ job, source, startedAt: now })
      .returning({ id: dataImportRuns.id });
    return rows[0]?.id ?? null;
  });
}

export type ImportRunOutcome = {
  ok: boolean;
  rowsRead?: number;
  rowsWritten?: number;
  /** Rows rejected by a unique constraint. Expected on every re-run, not a fault. */
  rowsSkipped?: number;
  error?: string | null;
  detail?: Record<string, unknown> | null;
};

/** Close an ingestion run. A `null` id (no database) is a silent no-op. */
export async function finishImportRun(
  runId: string | null,
  outcome: ImportRunOutcome,
  now: Date = new Date(),
): Promise<void> {
  if (!runId) return;

  await withDb('health.finishImportRun', undefined, async (db) => {
    await db
      .update(dataImportRuns)
      .set({
        finishedAt: now,
        ok: outcome.ok,
        rowsRead: outcome.rowsRead ?? 0,
        rowsWritten: outcome.rowsWritten ?? 0,
        rowsSkipped: outcome.rowsSkipped ?? 0,
        error: outcome.error ?? null,
        detail: outcome.detail ?? null,
      })
      .where(eq(dataImportRuns.id, runId));
  });
}

/** Recent runs of one job, newest first. */
export async function listRecentImportRuns(job: string, limit = 20): Promise<DataImportRunRow[]> {
  return withDb('health.listRecentRuns', [] as DataImportRunRow[], (db) =>
    db
      .select()
      .from(dataImportRuns)
      .where(eq(dataImportRuns.job, job))
      .orderBy(desc(dataImportRuns.startedAt))
      .limit(Math.min(limit, 200)),
  );
}

/* -------------------------------------------------------------------------- */
/*  Retention                                                                 */
/* -------------------------------------------------------------------------- */

export type OperationalCleanupResult = {
  probes: number;
  importRuns: number;
};

/** Drop telemetry past its retention window. */
export async function pruneOperationalLogs(
  now: Date = new Date(),
): Promise<OperationalCleanupResult> {
  const probeCutoff = retentionCutoff('providerHealth', now);
  const runCutoff = retentionCutoff('dataImportRuns', now);

  return withDb('health.prune', { probes: 0, importRuns: 0 }, async (db) => {
    let probes = 0;
    let importRuns = 0;

    if (probeCutoff) {
      const removed = await db
        .delete(providerHealth)
        .where(lte(providerHealth.checkedAt, probeCutoff))
        .returning({ id: providerHealth.id });
      probes = removed.length;
    }

    if (runCutoff) {
      const removed = await db
        .delete(dataImportRuns)
        .where(lte(dataImportRuns.startedAt, runCutoff))
        .returning({ id: dataImportRuns.id });
      importRuns = removed.length;
    }

    logger.info('health.pruned', { probes, importRuns });
    return { probes, importRuns };
  });
}
