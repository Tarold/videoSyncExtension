import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import type { Logger } from '../logger.js';

/** Resolves to <package>/migrations from both src/db and dist/db. */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../migrations', import.meta.url),
);

const MIGRATION_FILE = /^\d{3}_[\w-]+\.sql$/;
// Arbitrary constant so concurrent server instances don't run migrations twice.
const MIGRATION_LOCK_ID = 727_001;

/** Applies pending `NNN_name.sql` files in order, each in its own transaction. */
export async function migrate(
  pool: Pool,
  logger: Logger,
  dir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  const files = (await readdir(dir))
    .filter((f) => MIGRATION_FILE.test(f))
    .sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    );
    const done = new Set(rows.map((r) => r.version));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed`, { cause: err });
      }
      applied.push(file);
      logger.info({ migration: file }, 'Applied migration');
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    client.release();
  }
  return applied;
}
