import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../../src/protocol.js';

describe('parseClientMessage', () => {
  it('accepts create-room as sent by the extension', () => {
    const result = parseClientMessage(
      JSON.stringify({
        action: 'create-room',
        userId: 'user_1',
        payload: { url: 'https://x.example' },
      }),
    );
    expect(result).toEqual({
      ok: true,
      message: {
        action: 'create-room',
        userId: 'user_1',
        payload: { url: 'https://x.example' },
      },
    });
  });

  it('accepts video-update with a player state', () => {
    const result = parseClientMessage(
      JSON.stringify({
        action: 'video-update',
        userId: 'user_1',
        roomId: '123',
        payload: {
          playerState: { playerStatus: 'PLAYING', second: 1.5, timestamp: 1 },
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('strips unknown settings keys', () => {
    const result = parseClientMessage(
      JSON.stringify({
        action: 'update-settings',
        userId: 'u',
        roomId: '123',
        payload: { settings: { democracy: false, isAdmin: true } },
      }),
    );
    expect(result.ok && result.message.action === 'update-settings').toBe(true);
    if (result.ok && result.message.action === 'update-settings') {
      expect(result.message.payload.settings).toEqual({ democracy: false });
    }
  });

  it('rejects invalid JSON', () => {
    expect(parseClientMessage('{nope')).toEqual({
      ok: false,
      error: 'Invalid JSON',
    });
  });

  it.each([
    ['unknown action', { action: 'hack', userId: 'u' }],
    ['missing userId', { action: 'join-room', roomId: '123' }],
    ['missing roomId', { action: 'join-room', userId: 'u' }],
    [
      'negative position',
      {
        action: 'video-update',
        userId: 'u',
        roomId: '123',
        payload: {
          playerState: { playerStatus: 'PLAYING', second: -1, timestamp: 1 },
        },
      },
    ],
    ['oversized userId', { action: 'leave-room', userId: 'u'.repeat(51) }],
  ])('rejects %s', (_name, message) => {
    const result = parseClientMessage(JSON.stringify(message));
    expect(result.ok).toBe(false);
  });
});
