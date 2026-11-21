/**
 * Scripted end-to-end check against a running server, replaying what two browsers with the
 * extension send. Usage: SERVER_URL=ws://localhost:3000 npm run smoke
 */
import assert from 'node:assert/strict';
import { TestClient } from '../tests/ws-client.js';

const url = process.env.SERVER_URL ?? 'ws://localhost:3000';
const run = Date.now().toString(36);

const alice = await TestClient.connect(url, `user_a${run}`);
const bob = await TestClient.connect(url, `user_b${run}`);

try {
  alice.send({
    action: 'create-room',
    payload: { url: 'https://video.example/smoke' },
  });
  const joined = await alice.next('joined');
  assert.equal(joined.isOwner, true);
  console.log(`✓ create-room → joined ${joined.roomId} ${joined.roomName}`);

  bob.send({ action: 'join-room', roomId: joined.roomId });
  assert.equal((await bob.next('joined')).isOwner, false);
  const meta = await bob.next('room-meta-update');
  assert.deepEqual(meta.users, [alice.userId, bob.userId]);
  console.log('✓ join-room → joined + room-meta-update');

  bob.send({ action: 'get-state', roomId: joined.roomId });
  assert.equal((await bob.next('sync-video')).initiatorId, 'server');
  console.log('✓ get-state → sync-video');

  const playerState = {
    playerStatus: 'PLAYING',
    second: 12.3,
    timestamp: Date.now(),
  };
  alice.send({
    action: 'video-update',
    roomId: joined.roomId,
    payload: { playerState },
  });
  const sync = await bob.next('sync-video');
  assert.deepEqual(sync.state, playerState);
  assert.equal(sync.initiatorId, alice.userId);
  console.log('✓ video-update → sync-video relayed to the other member');

  alice.send({
    action: 'update-settings',
    roomId: joined.roomId,
    payload: { settings: { democracy: false } },
  });
  assert.equal((await bob.next('room-meta-update')).settings.democracy, false);
  console.log('✓ update-settings → room-meta-update');

  bob.send({
    action: 'update-settings',
    roomId: joined.roomId,
    payload: { settings: { democracy: true } },
  });
  assert.equal(
    (await bob.next('error')).message,
    'Only room owner can change settings',
  );
  console.log('✓ non-owner update-settings → error');

  alice.send({ action: 'leave-room', roomId: joined.roomId });
  assert.equal((await bob.next('room-meta-update')).ownerId, bob.userId);
  console.log('✓ leave-room → ownership transferred');
  console.log('Smoke test passed');
} finally {
  await Promise.all([alice.close(), bob.close()]);
}
