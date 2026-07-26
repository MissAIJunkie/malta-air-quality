/**
 * Environmental event persistence.
 *
 * Events are context, never evidence. They explain *why* a reading might look
 * the way it does; they never change a reading, a category or a threshold. The
 * schema keeps `relevance` and `confidence` alongside every row precisely so a
 * weak signal can be presented weakly.
 *
 * Rows are never deleted (`RETENTION.environmentalEvents` is indefinite) — a
 * past episode has to stay explainable. Events that stop being current are
 * deactivated instead.
 */

import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import { logger } from '@/lib/monitoring/logger';
import { withDb } from '../client';
import {
  environmentalEvents,
  type EnvironmentalEventRow,
  type NewEnvironmentalEventRow,
} from '../schema';

/**
 * Insert an event, or fold a re-observation into the row already on file.
 *
 * On conflict only the fields that can legitimately change are updated:
 * `lastSeenAt`, the classification, and the summary. `firstSeenAt` is never
 * touched — when maqua.app first heard about an event is a fact about our
 * record, and rewriting it would make the timeline of an episode unreliable.
 */
export async function upsertEvent(
  event: NewEnvironmentalEventRow,
  now: Date = new Date(),
): Promise<EnvironmentalEventRow | null> {
  return withDb('events.upsert', null as EnvironmentalEventRow | null, async (db) => {
    const rows = await db
      .insert(environmentalEvents)
      .values({ ...event, firstSeenAt: event.firstSeenAt ?? now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: environmentalEvents.dedupeHash,
        set: {
          title: sql`excluded.title`,
          summary: sql`excluded.summary`,
          kind: sql`excluded.kind`,
          relevance: sql`excluded.relevance`,
          confidence: sql`excluded.confidence`,
          publishedAt: sql`excluded.published_at`,
          latitude: sql`excluded.latitude`,
          longitude: sql`excluded.longitude`,
          affectsIslands: sql`excluded.affects_islands`,
          relatedPollutants: sql`excluded.related_pollutants`,
          detail: sql`excluded.detail`,
          lastSeenAt: sql`excluded.last_seen_at`,
          active: sql`true`,
        },
      })
      .returning();

    return rows[0] ?? null;
  });
}

/** Batch form of {@link upsertEvent}. Returns the number of rows written. */
export async function upsertEvents(
  events: NewEnvironmentalEventRow[],
  now: Date = new Date(),
): Promise<number> {
  if (events.length === 0) return 0;

  return withDb('events.upsertMany', 0, async (db) => {
    const rows = await db
      .insert(environmentalEvents)
      .values(events.map((e) => ({ ...e, firstSeenAt: e.firstSeenAt ?? now, lastSeenAt: now })))
      .onConflictDoUpdate({
        target: environmentalEvents.dedupeHash,
        set: {
          title: sql`excluded.title`,
          summary: sql`excluded.summary`,
          relevance: sql`excluded.relevance`,
          confidence: sql`excluded.confidence`,
          detail: sql`excluded.detail`,
          lastSeenAt: sql`excluded.last_seen_at`,
          active: sql`true`,
        },
      })
      .returning({ id: environmentalEvents.id });

    return rows.length;
  });
}

export type ListEventsOptions = {
  /** Only events seen since this instant. */
  since?: Date;
  /** Restrict to these relevance bands. Defaults to all. */
  relevance?: ('high' | 'medium' | 'low')[];
  /** Include events that have been deactivated. Defaults to false. */
  includeInactive?: boolean;
  limit?: number;
};

/**
 * Current events, most recently seen first.
 *
 * Returns `[]` with no database, which the UI must render as "no context
 * available" rather than as "nothing is happening".
 */
export async function listEvents(
  options: ListEventsOptions = {},
): Promise<EnvironmentalEventRow[]> {
  const limit = Math.min(options.limit ?? 20, 100);

  return withDb('events.list', [] as EnvironmentalEventRow[], (db) => {
    const conditions = [];
    if (!options.includeInactive) conditions.push(eq(environmentalEvents.active, true));
    if (options.since) conditions.push(gte(environmentalEvents.lastSeenAt, options.since));
    if (options.relevance?.length) {
      conditions.push(inArray(environmentalEvents.relevance, options.relevance));
    }

    return db
      .select()
      .from(environmentalEvents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(environmentalEvents.lastSeenAt))
      .limit(limit);
  });
}

/** Look up one event by its dedupe hash, to decide whether a crawl found
 *  something new before doing any further work on it. */
export async function findEventByHash(dedupeHash: string): Promise<EnvironmentalEventRow | null> {
  return withDb('events.findByHash', null as EnvironmentalEventRow | null, async (db) => {
    const rows = await db
      .select()
      .from(environmentalEvents)
      .where(eq(environmentalEvents.dedupeHash, dedupeHash))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Mark events not seen since `cutoff` as no longer current.
 *
 * Deactivation, not deletion — the row remains available to explain a reading
 * from the period it covered.
 */
export async function deactivateStaleEvents(cutoff: Date): Promise<number> {
  return withDb('events.deactivateStale', 0, async (db) => {
    const rows = await db
      .update(environmentalEvents)
      .set({ active: false })
      .where(and(eq(environmentalEvents.active, true), lt(environmentalEvents.lastSeenAt, cutoff)))
      .returning({ id: environmentalEvents.id });

    if (rows.length > 0) logger.info('events.deactivated', { count: rows.length });
    return rows.length;
  });
}
