/**
 * Reading persistence.
 *
 * Ingestion is idempotent by construction: every write is a single INSERT with
 * `ON CONFLICT DO NOTHING` against the natural key
 * `(station_id, pollutant, measured_at, source)`. Re-running the hourly job,
 * overlapping cron invocations and a manual backfill of the same window are all
 * safe, and none of them can produce a duplicate hour.
 *
 * Nothing here throws at the caller. Persistence is optional (see
 * `src/db/client.ts`), so every function has a documented no-database result.
 */

import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';

import { type PollutantCode } from '@/config/pollutants';
import { STATIONS } from '@/config/stations';
import { AQI_BREAKPOINTS, type AirQualityCategory } from '@/config/thresholds';
import { logger } from '@/lib/monitoring/logger';
import type { HistoricalReading, PollutantReading, StationReading } from '@/lib/air-quality/types';
import { withDb } from '../client';
import { retentionCutoff } from '../retention';
import {
  airQualityForecasts,
  airQualityReadings,
  airQualityStations,
  type NewAirQualityForecastRow,
  type NewAirQualityReadingRow,
} from '../schema';

/**
 * Fingerprint of the values that make a measurement what it is.
 *
 * Deliberately excludes `fetchedAt` and the row id: two fetches of the same
 * unchanged hour must produce the same checksum, otherwise it cannot be used to
 * spot an upstream revision. `value === null` is encoded as the literal string
 * `null`, never as `0`.
 */
export function readingChecksum(input: {
  stationId: string;
  pollutant: PollutantCode;
  measuredAt: string;
  value: number | null;
  unit: string;
  category: AirQualityCategory | null;
  subIndex: number | null;
  modelled: boolean;
  source: string;
}): string {
  const canonical = [
    input.stationId,
    input.pollutant,
    input.measuredAt,
    input.value === null ? 'null' : input.value.toString(),
    input.unit,
    input.category ?? 'null',
    input.subIndex === null ? 'null' : input.subIndex.toFixed(2),
    input.modelled ? '1' : '0',
    input.source,
  ].join('|');

  return createHash('sha256').update(canonical).digest('hex');
}

/* -------------------------------------------------------------------------- */
/*  Station master data                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Mirror `src/config/stations.ts` into the database.
 *
 * Readings carry a foreign key to `air_quality_stations`, so this must succeed
 * before the first reading of a deployment can be stored. It is safe to call on
 * every ingestion run — conflicting rows are updated in place, and `firstSeenAt`
 * is never touched once set.
 *
 * @returns the number of station rows written, or 0 with no database.
 */
export async function syncStations(now: Date = new Date()): Promise<number> {
  return withDb('readings.syncStations', 0, async (db) => {
    const rows = STATIONS.map((station) => ({
      id: station.id,
      slug: station.slug,
      name: station.name,
      upstreamName: station.upstreamName,
      locality: station.locality,
      island: station.island,
      latitude: station.latitude,
      longitude: station.longitude,
      altitudeMetres: station.altitudeMetres,
      stationType: station.stationType,
      areaClassification: station.areaClassification,
      expectedPollutants: station.expectedPollutants,
      operator: station.operator,
      sourceUrl: station.sourceUrl,
      active: station.active,
      firstSeenAt: now,
      lastSeenAt: now,
    }));

    const written = await db
      .insert(airQualityStations)
      .values(rows)
      .onConflictDoUpdate({
        target: airQualityStations.id,
        set: {
          slug: sql`excluded.slug`,
          name: sql`excluded.name`,
          upstreamName: sql`excluded.upstream_name`,
          locality: sql`excluded.locality`,
          island: sql`excluded.island`,
          latitude: sql`excluded.latitude`,
          longitude: sql`excluded.longitude`,
          altitudeMetres: sql`excluded.altitude_metres`,
          stationType: sql`excluded.station_type`,
          areaClassification: sql`excluded.area_classification`,
          expectedPollutants: sql`excluded.expected_pollutants`,
          operator: sql`excluded.operator`,
          sourceUrl: sql`excluded.source_url`,
          active: sql`excluded.active`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      })
      .returning({ id: airQualityStations.id });

    return written.length;
  });
}

/* -------------------------------------------------------------------------- */
/*  Writing readings                                                          */
/* -------------------------------------------------------------------------- */

export type IngestResult = {
  /** Rows offered to the database. */
  read: number;
  /** Rows actually inserted. */
  written: number;
  /** Rows the unique constraint rejected as already known. Expected, not an error. */
  skipped: number;
};

const EMPTY_INGEST: IngestResult = { read: 0, written: 0, skipped: 0 };

/**
 * Flatten a domain `StationReading` into one row per pollutant.
 *
 * Pollutants whose `value` is `null` are still stored: "the analyser reported
 * nothing at 14:00" is itself a fact worth keeping, and dropping those rows
 * would make a gap in the record indistinguishable from a gap in ingestion.
 */
export function toReadingRows(reading: StationReading): NewAirQualityReadingRow[] {
  const measuredAt = new Date(reading.measuredAt);
  const fetchedAt = new Date(reading.fetchedAt);

  return Object.values(reading.pollutants)
    .filter((p): p is PollutantReading => Boolean(p))
    .map((p) => ({
      stationId: reading.stationId,
      pollutant: p.pollutant,
      value: p.value,
      unit: p.unit,
      subIndex: p.subIndex,
      category: p.category,
      averagingPeriod: p.averagingPeriod,
      measuredAt,
      fetchedAt,
      provisional: reading.provisional,
      modelled: p.modelled,
      source: reading.source,
      checksum: readingChecksum({
        stationId: reading.stationId,
        pollutant: p.pollutant,
        measuredAt: reading.measuredAt,
        value: p.value,
        unit: p.unit,
        category: p.category,
        subIndex: p.subIndex,
        modelled: p.modelled,
        source: reading.source,
      }),
    }));
}

/**
 * Insert readings, ignoring any hour already on record.
 *
 * DO NOTHING rather than DO UPDATE is a deliberate archival choice: the first
 * observation of an hour is what maqua.app actually published, and silently
 * rewriting it when the upstream revises a provisional value would make the
 * history unfalsifiable. Revisions are detectable through `checksum`.
 */
export async function upsertReadings(rows: NewAirQualityReadingRow[]): Promise<IngestResult> {
  if (rows.length === 0) return EMPTY_INGEST;

  return withDb('readings.upsertReadings', { ...EMPTY_INGEST, read: rows.length }, async (db) => {
    const inserted = await db
      .insert(airQualityReadings)
      .values(rows)
      .onConflictDoNothing({
        target: [
          airQualityReadings.stationId,
          airQualityReadings.pollutant,
          airQualityReadings.measuredAt,
          airQualityReadings.source,
        ],
      })
      .returning({ id: airQualityReadings.id });

    const result: IngestResult = {
      read: rows.length,
      written: inserted.length,
      skipped: rows.length - inserted.length,
    };

    logger.info('db.readings_ingested', { ...result });
    return result;
  });
}

/** Convenience wrapper: persist a batch of domain readings in one statement. */
export async function storeStationReadings(readings: StationReading[]): Promise<IngestResult> {
  return upsertReadings(readings.flatMap(toReadingRows));
}

/**
 * Persist forecast points.
 *
 * Separate table, separate function, separate unique key. Nothing in this
 * module can move a forecast into `air_quality_readings`.
 */
export async function upsertForecasts(rows: NewAirQualityForecastRow[]): Promise<IngestResult> {
  if (rows.length === 0) return EMPTY_INGEST;

  return withDb('readings.upsertForecasts', { ...EMPTY_INGEST, read: rows.length }, async (db) => {
    const inserted = await db
      .insert(airQualityForecasts)
      .values(rows)
      .onConflictDoNothing({
        target: [
          airQualityForecasts.stationId,
          airQualityForecasts.pollutant,
          airQualityForecasts.validAt,
          airQualityForecasts.issuedAt,
          airQualityForecasts.source,
        ],
      })
      .returning({ id: airQualityForecasts.id });

    return {
      read: rows.length,
      written: inserted.length,
      skipped: rows.length - inserted.length,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Reading history back                                                      */
/* -------------------------------------------------------------------------- */

export type HistoryWindow = {
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound. Defaults to now. */
  to?: Date;
};

/**
 * Stored history for one station, grouped into one entry per hour.
 *
 * Returns `[]` with no database — the caller falls back to the ~10 days the
 * upstream feed itself carries, which is why a missing database degrades the
 * range of history rather than breaking the page.
 */
export async function getStoredHistory(
  stationId: string,
  window: HistoryWindow,
): Promise<HistoricalReading[]> {
  const to = window.to ?? new Date();

  return withDb('readings.getStoredHistory', [] as HistoricalReading[], async (db) => {
    const rows = await db
      .select()
      .from(airQualityReadings)
      .where(
        and(
          eq(airQualityReadings.stationId, stationId),
          gte(airQualityReadings.measuredAt, window.from),
          lt(airQualityReadings.measuredAt, to),
        ),
      )
      .orderBy(asc(airQualityReadings.measuredAt));

    return groupByHour(rows);
  });
}

/**
 * Fold flat pollutant rows into the domain's per-hour shape.
 *
 * `overallCategory` and `dominantPollutant` are deliberately NOT recomputed
 * here — they are read back from the stored per-pollutant categories, which were
 * computed once by `calculate-index.ts` at ingestion time. Recomputing would
 * risk two different answers for the same hour if the breakpoints ever change.
 */
function groupByHour(rows: (typeof airQualityReadings.$inferSelect)[]): HistoricalReading[] {
  const byHour = new Map<string, HistoricalReading>();

  for (const row of rows) {
    const key = row.measuredAt.toISOString();
    let entry = byHour.get(key);
    if (!entry) {
      entry = {
        stationId: row.stationId,
        measuredAt: key,
        pollutants: {},
        overallCategory: null,
        dominantPollutant: null,
        // Stored rows in this table are observations by definition; the forecast
        // table is separate. `modelled` still distinguishes gap-filled hours.
        forecast: false,
      };
      byHour.set(key, entry);
    }

    entry.pollutants[row.pollutant] = {
      pollutant: row.pollutant,
      value: row.value,
      unit: row.unit,
      category: row.category,
      subIndex: row.subIndex,
      averagingPeriod: row.averagingPeriod,
      thresholdReference: AQI_BREAKPOINTS[row.pollutant].reference,
      modelled: row.modelled,
    };

    // Worst pollutant wins, matching `calculateOverall`.
    if (row.subIndex !== null && (entry.overallCategory === null || isWorse(row, entry))) {
      entry.overallCategory = row.category;
      entry.dominantPollutant = row.pollutant;
    }
  }

  return [...byHour.values()].sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));
}

function isWorse(row: typeof airQualityReadings.$inferSelect, entry: HistoricalReading): boolean {
  const current = entry.dominantPollutant
    ? (entry.pollutants[entry.dominantPollutant]?.subIndex ?? null)
    : null;
  if (current === null) return true;
  return (row.subIndex ?? 0) > current;
}

/** Most recent stored hour for a station, or `null`. Used to decide how far back
 *  a backfill needs to reach. */
export async function getLatestStoredHour(stationId: string): Promise<Date | null> {
  return withDb('readings.getLatestStoredHour', null as Date | null, async (db) => {
    const rows = await db
      .select({ measuredAt: airQualityReadings.measuredAt })
      .from(airQualityReadings)
      .where(eq(airQualityReadings.stationId, stationId))
      .orderBy(desc(airQualityReadings.measuredAt))
      .limit(1);

    return rows[0]?.measuredAt ?? null;
  });
}

/**
 * Readings across all stations within a window, oldest first.
 *
 * Feeds the weekly-summary email and the trends view.
 */
export async function getReadingsInWindow(window: HistoryWindow) {
  const to = window.to ?? new Date();

  return withDb(
    'readings.getReadingsInWindow',
    [] as (typeof airQualityReadings.$inferSelect)[],
    (db) =>
      db
        .select()
        .from(airQualityReadings)
        .where(
          and(
            gte(airQualityReadings.measuredAt, window.from),
            lt(airQualityReadings.measuredAt, to),
          ),
        )
        .orderBy(asc(airQualityReadings.measuredAt)),
  );
}

/* -------------------------------------------------------------------------- */
/*  Retention                                                                 */
/* -------------------------------------------------------------------------- */

export type CleanupResult = {
  readings: number;
  forecasts: number;
};

/**
 * Delete rows past their retention window.
 *
 * An indefinite policy yields a `null` cutoff, and a `null` cutoff deletes
 * nothing — the guard below is the difference between "keep forever" and "delete
 * everything", so it is checked explicitly rather than inferred.
 */
export async function pruneReadings(now: Date = new Date()): Promise<CleanupResult> {
  const readingsCutoff = retentionCutoff('rawReadings', now);
  const forecastCutoff = retentionCutoff('forecasts', now);

  return withDb('readings.pruneReadings', { readings: 0, forecasts: 0 }, async (db) => {
    let readings = 0;
    let forecasts = 0;

    if (readingsCutoff) {
      const deleted = await db
        .delete(airQualityReadings)
        .where(lte(airQualityReadings.measuredAt, readingsCutoff))
        .returning({ id: airQualityReadings.id });
      readings = deleted.length;
    }

    if (forecastCutoff) {
      const deleted = await db
        .delete(airQualityForecasts)
        .where(lte(airQualityForecasts.validAt, forecastCutoff))
        .returning({ id: airQualityForecasts.id });
      forecasts = deleted.length;
    }

    logger.info('db.readings_pruned', { readings, forecasts });
    return { readings, forecasts };
  });
}
