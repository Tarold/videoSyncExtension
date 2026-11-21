import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type App, startApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { PostgresRoomStore } from '../../src/persistence/postgres-store.js';
import { silentLogger } from '../helpers.js';
import { TestClient } from '../ws-client.js';
import { freshDatabase, testDatabaseUrl, truncateAll } from './db.js';

/** End-to-end: real WebSocket clients against the server backed by real PostgreSQL. */
describe('WebSocket server with PostgreSQL', () => {
  let pool: pg.Pool;
  let app: App;
  let clients: TestClient[] = [];

  function start() {
    return startApp(
      loadConfig({
        PORT: '0',
        HOST: '127.0.0.1',
        DATABASE_URL: testDatabaseUrl(),
      }),
      silentLogger,
    );
  }

  async function client(userId: string) {
    const c = await TestClient.connect(`ws://127.0.0.1:${app.port}`, userId);
    clients.push(c);
    return c;
  }

  async function createRoom(
    owner: TestClient,
    url = 'https://video.example/1',
  ) {
    owner.send({ action: 'create-room', payload: { url } });
    return owner.next('joined');
  }

  beforeAll(async () => {
    pool = await freshDatabase();
    app = await start();
  });

  afterEach(async () => {
    await Promise.all(clients.map((c) => c.close()));
    clients = [];
    await truncateAll(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('serves a health check', async () => {
    const res = await fetch(`http://127.0.0.1:${app.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('runs the extension flow: create, join, get-state, sync, settings', async () => {
    const alice = await client('user_1');
    const joined = await createRoom(alice);
    expect(joined).toMatchObject({
      roomId: expect.stringMatching(/^\d{3}$/) as string,
      isOwner: true,
      settings: { democracy: true, autoSyncUrl: false },
      videoUrl: 'https://video.example/1',
    });
    const { roomId } = joined;

    const bob = await client('user_2');
    bob.send({ action: 'join-room', roomId });
    expect(await bob.next('joined')).toMatchObject({ roomId, isOwner: false });
    expect(await alice.next('room-meta-update')).toMatchObject({
      users: ['user_1'],
    });
    expect(await alice.next('room-meta-update')).toMatchObject({
      users: ['user_1', 'user_2'],
      ownerId: 'user_1',
    });

    bob.send({ action: 'get-state', roomId });
    expect(await bob.next('sync-video')).toMatchObject({
      state: { playerStatus: 'INIT', second: 0 },
      initiatorId: 'server',
    });

    const playerState = { playerStatus: 'PLAYING', second: 42.5, timestamp: 1 };
    bob.send({ action: 'video-update', roomId, payload: { playerState } });
    expect(await alice.next('sync-video')).toEqual({
      action: 'sync-video',
      state: playerState,
      videoUrl: 'https://video.example/1',
      initiatorId: 'user_2',
    });
    await bob.expectNone('sync-video');

    alice.send({
      action: 'update-settings',
      roomId,
      payload: { settings: { democracy: false } },
    });
    expect(await bob.next('room-meta-update')).toMatchObject({
      settings: { democracy: false, autoSyncUrl: false },
    });

    // Bob is no longer allowed to control playback; the update is dropped silently.
    bob.send({ action: 'video-update', roomId, payload: { playerState } });
    await alice.expectNone('sync-video');

    const { rows } = await pool.query<{ democracy: boolean }>(
      'SELECT democracy FROM room_settings WHERE room_id = $1',
      [roomId],
    );
    expect(rows[0]?.democracy).toBe(false);
  });

  it('rejects settings changes from non-owners', async () => {
    const alice = await client('user_1');
    const { roomId } = await createRoom(alice);
    const bob = await client('user_2');
    bob.send({ action: 'join-room', roomId });
    await bob.next('joined');

    bob.send({
      action: 'update-settings',
      roomId,
      payload: { settings: { democracy: false } },
    });
    expect(await bob.next('error')).toEqual({
      action: 'error',
      message: 'Only room owner can change settings',
    });
  });

  it('reports unknown rooms and invalid messages as errors', async () => {
    const alice = await client('user_1');
    alice.send({ action: 'join-room', roomId: '000' });
    expect((await alice.next('error')).message).toBe('Room not found');

    alice.sendRaw('not json');
    expect((await alice.next('error')).message).toBe('Invalid JSON');

    alice.send({ action: 'video-update', roomId: '123' });
    expect((await alice.next('error')).message).toMatch(
      /^Invalid message: payload/,
    );
  });

  it('transfers ownership when the owner disconnects and deletes empty rooms', async () => {
    const alice = await client('user_1');
    const { roomId } = await createRoom(alice);
    const bob = await client('user_2');
    bob.send({ action: 'join-room', roomId });
    await bob.next('joined');
    await bob.next('room-meta-update');

    await alice.close();
    expect(await bob.next('room-meta-update')).toMatchObject({
      users: ['user_2'],
      ownerId: 'user_2',
      hosts: ['user_1', 'user_2'],
    });
    const store = new PostgresRoomStore(pool);
    expect((await store.findRoom(roomId))?.ownerId).toBe('user_2');

    bob.send({ action: 'leave-room', roomId });
    await expect.poll(() => store.roomExists(roomId)).toBe(false);
  });

  it('keeps rooms across a server restart so clients can rejoin', async () => {
    const alice = await client('user_1');
    const { roomId, roomName } = await createRoom(alice);
    alice.send({
      action: 'update-settings',
      roomId,
      payload: { settings: { democracy: false } },
    });
    await alice.next('room-meta-update');
    await alice.next('room-meta-update');

    await app.close();
    app = await start();

    const rejoined = await client('user_1');
    rejoined.send({ action: 'join-room', roomId });
    expect(await rejoined.next('joined')).toMatchObject({
      roomId,
      roomName,
      isOwner: true,
      settings: { democracy: false, autoSyncUrl: false },
    });
  });
});
