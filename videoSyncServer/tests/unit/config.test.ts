import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({
      host: '0.0.0.0',
      port: 3000,
      databaseUrl: undefined,
      databasePoolMax: 10,
      migrateOnStart: true,
      roomIdleTtlMs: 24 * 60 * 60 * 1000,
      logLevel: 'info',
    });
  });

  it('reads values from the environment', () => {
    const config = loadConfig({
      HOST: '127.0.0.1',
      PORT: '8080',
      DATABASE_URL: 'postgres://u:p@db:5432/videosync',
      MIGRATE_ON_START: 'false',
      ROOM_IDLE_TTL_HOURS: '2',
      LOG_LEVEL: 'debug',
    });
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 8080,
      databaseUrl: 'postgres://u:p@db:5432/videosync',
      migrateOnStart: false,
      roomIdleTtlMs: 2 * 60 * 60 * 1000,
      logLevel: 'debug',
    });
  });

  it('treats empty strings as unset', () => {
    expect(
      loadConfig({ DATABASE_URL: '', PORT: '' }).databaseUrl,
    ).toBeUndefined();
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});
