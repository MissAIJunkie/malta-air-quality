/**
 * Database client — lazily created, and optional by design.
 *
 * The brief's hard constraint is that maqua.app must run with no database at
 * all. So this module never throws for a missing `DATABASE_URL`: it returns
 * `null`, and every caller in `src/db/queries/*` treats `null` as "persistence
 * is switched off" rather than as an error. The map, the station pages and
 * `/api/air-quality` are unaffected.
 *
 * Neon's HTTP driver is used rather than a pooled TCP connection because the app
 * runs on serverless functions, where a connection pool is a liability: each
 * query is a stateless fetch, so there is nothing to leak between invocations.
 * The consequence is that multi-statement transactions are not available over
 * this driver — every write in this codebase is therefore a single statement,
 * made idempotent by a unique constraint instead of by a transaction.
 */

import 'server-only';

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';

import { getEnv } from '@/config/env';
import { logger } from '@/lib/monitoring/logger';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = NeonHttpDatabase<Schema>;

let client: Database | null = null;
/** Set once the first attempt has been made, so a missing URL is logged once. */
let initialised = false;

/**
 * Whether persistence is available in this deployment.
 *
 * Cheap and side-effect free — safe to call on a hot path to decide whether to
 * bother building a write payload.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(getEnv().DATABASE_URL);
}

/**
 * The Drizzle client, or `null` when no database is configured.
 *
 * Callers MUST handle `null`. Returning it is not an error path — it is the
 * documented no-database mode.
 */
export function getDb(): Database | null {
  if (client) return client;

  const url = getEnv().DATABASE_URL;
  if (!url) {
    if (!initialised) {
      initialised = true;
      logger.info('db.not_configured', {
        detail: 'DATABASE_URL is unset; history, alerts and audit logging are disabled.',
      });
    }
    return null;
  }

  try {
    client = drizzle(neon(url), { schema });
    initialised = true;
    return client;
  } catch (error) {
    // A malformed connection string must degrade to no-database mode, not take
    // down a request that never needed the database in the first place.
    logger.error('db.client_init_failed', { error: String(error) });
    initialised = true;
    return null;
  }
}

/**
 * Run `fn` only when a database exists, returning `fallback` otherwise, and
 * swallowing query failures into `fallback` as well.
 *
 * Persistence is an enhancement here: a Neon outage must not turn a page that
 * only needs live upstream data into a 500. Failures are logged with the calling
 * operation so they stay visible in the log drain.
 */
export async function withDb<T>(
  operation: string,
  fallback: T,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const db = getDb();
  if (!db) return fallback;

  try {
    return await fn(db);
  } catch (error) {
    logger.error('db.query_failed', { operation, error: String(error) });
    return fallback;
  }
}

/** Test hook. Never called on a production path. */
export function resetDbClient(): void {
  client = null;
  initialised = false;
}
