import { describe, expect, it } from 'vitest';
import {
  type Room,
  ROOM_EMOJIS,
  applyVideoUpdate,
  canControlPlayback,
  mergeSettings,
  randomRoomId,
  randomRoomName,
  roleOf,
  transferOwnership,
} from '../../src/domain/room.js';
import { FakeConnection } from '../helpers.js';

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: '123',
    name: '🍿🍿🍿',
    ownerId: 'owner',
    hosts: ['owner'],
    settings: { democracy: true, autoSyncUrl: false },
    videoUrl: null,
    playerState: { playerStatus: 'INIT', second: 0, timestamp: 0 },
    members: new Map(),
    ...overrides,
  };
}

describe('room codes and names', () => {
  it('generates three-digit codes across the full range', () => {
    expect(randomRoomId(() => 0)).toBe('100');
    expect(randomRoomId(() => 0.999_999)).toBe('999');
  });

  it('builds names from three emojis', () => {
    expect(randomRoomName(() => 0)).toBe(ROOM_EMOJIS[0].repeat(3));
  });
});

describe('permissions', () => {
  it('lets anyone control playback in democracy mode', () => {
    expect(canControlPlayback(makeRoom(), 'guest')).toBe(true);
  });

  it('restricts playback to hosts when democracy is off', () => {
    const room = makeRoom({
      settings: { democracy: false, autoSyncUrl: false },
    });
    expect(canControlPlayback(room, 'guest')).toBe(false);
    expect(canControlPlayback(room, 'owner')).toBe(true);
  });

  it('derives roles', () => {
    const room = makeRoom({ hosts: ['owner', 'former-owner'] });
    expect(roleOf(room, 'owner')).toBe('OWNER');
    expect(roleOf(room, 'former-owner')).toBe('HOST');
    expect(roleOf(room, 'guest')).toBe('PARTICIPANT');
  });
});

describe('applyVideoUpdate', () => {
  it('replaces the player state', () => {
    const room = makeRoom();
    const state = { playerStatus: 'PLAYING', second: 42, timestamp: 5 };
    applyVideoUpdate(room, { playerState: state }, 10);
    expect(room.playerState).toEqual(state);
  });

  it('resets to a paused state at 0s when the URL changes', () => {
    const room = makeRoom({ videoUrl: 'https://a.example' });
    applyVideoUpdate(
      room,
      {
        videoUrl: 'https://b.example',
        playerState: { playerStatus: 'PLAYING', second: 42, timestamp: 5 },
      },
      10,
    );
    expect(room.videoUrl).toBe('https://b.example');
    expect(room.playerState).toEqual({
      playerStatus: 'PAUSE',
      second: 0,
      timestamp: 10,
    });
  });

  it('keeps the player state when the same URL is sent again', () => {
    const room = makeRoom({ videoUrl: 'https://a.example' });
    const state = { playerStatus: 'PLAYING', second: 3, timestamp: 1 };
    applyVideoUpdate(
      room,
      { videoUrl: 'https://a.example', playerState: state },
      10,
    );
    expect(room.playerState).toEqual(state);
  });
});

describe('mergeSettings', () => {
  it('only overrides provided keys', () => {
    expect(
      mergeSettings(
        { democracy: true, autoSyncUrl: false },
        { democracy: false },
      ),
    ).toEqual({ democracy: false, autoSyncUrl: false });
  });
});

describe('transferOwnership', () => {
  it('promotes the longest-standing member to owner and host', () => {
    const room = makeRoom();
    room.members.set('first', new FakeConnection());
    room.members.set('second', new FakeConnection());
    expect(transferOwnership(room)).toBe('first');
    expect(room.ownerId).toBe('first');
    expect(room.hosts).toEqual(['owner', 'first']);
  });

  it('returns undefined for an empty room', () => {
    expect(transferOwnership(makeRoom())).toBeUndefined();
  });
});
