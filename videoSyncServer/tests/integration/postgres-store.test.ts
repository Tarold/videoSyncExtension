import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresRoomStore } from '../../src/persistence/postgres-store.js';
import { freshDatabase, truncateAll } from './db.js';

const DEFAULTS = { democracy: true, autoSyncUrl: false };

describe('PostgresRoomStore', () => {
  let pool: pg.Pool;
  let store: PostgresRoomStore;

  beforeAll(async () => {
    pool = await freshDatabase();
    store = new PostgresRoomStore(pool);
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedRoom(id = '123', ownerId = 'alice') {
    await store.createRoom({ id, name: '🍿🎬🚀', ownerId, settings: DEFAULTS });
    await store.addMember(id, ownerId, 'OWNER');
  }

  it('creates and finds a room with settings and hosts', async () => {
    await seedRoom();
    await store.addMember('123', 'bob', 'PARTICIPANT');

    expect(await store.findRoom('123')).toEqual({
      id: '123',
      name: '🍿🎬🚀',
      ownerId: 'alice',
      settings: DEFAULTS,
      hosts: ['alice'],
    });
    expect(await store.roomExists('123')).toBe(true);
    expect(await store.findRoom('999')).toBeNull();
  });

  it('rolls back the room when settings cannot be written', async () => {
    await seedRoom('123');
    // Same id → primary key violation inside the transaction.
    await expect(
      store.createRoom({
        id: '123',
        name: 'dup',
        ownerId: 'x',
        settings: DEFAULTS,
      }),
    ).rejects.toThrow();
    expect((await store.findRoom('123'))?.name).toBe('🍿🎬🚀');
  });

  it('updates settings', async () => {
    await seedRoom();
    await store.updateSettings('123', { democracy: false, autoSyncUrl: true });
    expect((await store.findRoom('123'))?.settings).toEqual({
      democracy: false,
      autoSyncUrl: true,
    });
  });

  it('moves a user between rooms', async () => {
    await seedRoom('111', 'alice');
    await seedRoom('222', 'carol');
    await store.addMember('111', 'bob', 'HOST');
    await store.addMember('222', 'bob', 'PARTICIPANT');

    expect((await store.findRoom('111'))?.hosts).toEqual(['alice']);
    const { rows } = await pool.query<{ room_id: string }>(
      `SELECT room_id FROM users WHERE id = 'bob'`,
    );
    expect(rows[0]?.room_id).toBe('222');
  });

  it('removes members only from the given room', async () => {
    await seedRoom('111');
    await store.removeMember('999', 'alice');
    expect((await store.findRoom('111'))?.hosts).toEqual(['alice']);
    await store.removeMember('111', 'alice');
    expect((await store.findRoom('111'))?.hosts).toEqual([]);
  });

  it('transfers ownership', async () => {
    await seedRoom();
    await store.addMember('123', 'bob', 'PARTICIPANT');
    await store.removeMember('123', 'alice');
    await store.transferOwnership('123', 'bob');

    expect(await store.findRoom('123')).toMatchObject({
      ownerId: 'bob',
      hosts: ['bob'],
    });
  });

  it('deletes a room with its settings and detaches its users', async () => {
    await seedRoom();
    await store.deleteRoom('123');

    expect(await store.roomExists('123')).toBe(false);
    const settings = await pool.query('SELECT 1 FROM room_settings');
    expect(settings.rowCount).toBe(0);
    const { rows } = await pool.query<{ room_id: string | null }>(
      `SELECT room_id FROM users WHERE id = 'alice'`,
    );
    expect(rows[0]?.room_id).toBeNull();
  });

  it('prunes only rooms without recent activity', async () => {
    await seedRoom('111', 'alice');
    await seedRoom('222', 'bob');
    await pool.query(`UPDATE rooms SET created_at = now() - interval '2 days'`);
    await pool.query(
      `UPDATE users SET last_active = now() - interval '2 days' WHERE id = 'alice'`,
    );

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(await store.pruneIdleRooms(cutoff)).toBe(1);
    expect(await store.roomExists('111')).toBe(false);
    expect(await store.roomExists('222')).toBe(true);
  });
});
