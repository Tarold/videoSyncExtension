import pg from 'pg';
import { migrate } from '../../src/db/migrate.js';
import { silentLogger } from '../helpers.js';

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Integration tests need PostgreSQL. Run `docker compose up -d postgres --wait` and set ' +
        'DATABASE_URL=postgres://videosync:videosync@localhost:5432/videosync',
    );
  }
  return url;
}

/** Recreates the public schema and applies all migrations. */
export async function freshDatabase(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 5 });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool, silentLogger);
  return pool;
}

export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query('TRUNCATE rooms, room_settings, users CASCADE');
}
