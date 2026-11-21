import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate } from '../../src/db/migrate.js';
import { silentLogger } from '../helpers.js';
import { testDatabaseUrl } from './db.js';

describe('migrations', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: testDatabaseUrl() });
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('upgrades a database created with the legacy schema.sql', async () => {
    // Simulate an existing install: old schema, old defaults, no migrations table.
    const legacy = await readFile(
      path.join(MIGRATIONS_DIR, '001_initial_schema.sql'),
      'utf8',
    );
    await pool.query(legacy);
    await pool.query(
      `INSERT INTO rooms (id, name, owner_id) VALUES ('111', 'x', 'u1')`,
    );
    await pool.query(`INSERT INTO room_settings (room_id) VALUES ('111')`);

    const applied = await migrate(pool, silentLogger);
    expect(applied).toEqual([
      '001_initial_schema.sql',
      '002_align_settings_defaults.sql',
      '003_use_timestamptz.sql',
    ]);

    // Existing rows keep their values; new rows get the runtime defaults.
    await pool.query(
      `INSERT INTO rooms (id, name, owner_id) VALUES ('222', 'y', 'u2')`,
    );
    await pool.query(`INSERT INTO room_settings (room_id) VALUES ('222')`);
    const { rows } = await pool.query<{
      room_id: string;
      democracy: boolean;
      auto_sync_url: boolean;
    }>(
      'SELECT room_id, democracy, auto_sync_url FROM room_settings ORDER BY room_id',
    );
    expect(rows).toEqual([
      { room_id: '111', democracy: false, auto_sync_url: true },
      { room_id: '222', democracy: true, auto_sync_url: false },
    ]);
  });

  it('is idempotent', async () => {
    expect(await migrate(pool, silentLogger)).toEqual([]);
  });

  it('rejects unknown roles', async () => {
    await expect(
      pool.query(`INSERT INTO users (id, role) VALUES ('u9', 'ADMIN')`),
    ).rejects.toThrow(/users_role_check/);
  });
});
