/**
 * drizzle-kit configuration.
 *
 * Only used by `pnpm db:generate` / `db:migrate` / `db:studio`. The application
 * itself never loads this file, and runs perfectly well with no database at all
 * — see `src/db/client.ts`.
 *
 * Migrations are generated against `DATABASE_URL_UNPOOLED` when it is set. Neon's
 * pooled endpoint runs through PgBouncer in transaction mode, which cannot serve
 * the session-level statements DDL needs; pointing migrations at the direct
 * endpoint avoids a class of failure that otherwise only appears in production.
 */

import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Local runs read .env.local; on CI the variables are already in the environment
// and this call is a harmless no-op.
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  // Thrown rather than defaulted: a migration run against the wrong database is
  // far worse than one that refuses to start.
  throw new Error(
    'drizzle-kit needs DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL. ' +
      'The application itself does not — it runs without a database.',
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
