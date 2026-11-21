import type { Config } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { RoomService } from './domain/room-service.js';
import type { Logger } from './logger.js';
import { MemoryRoomStore } from './persistence/memory-store.js';
import { PostgresRoomStore } from './persistence/postgres-store.js';
import type { RoomStore } from './persistence/room-store.js';
import { createSyncServer, type HealthCheck } from './ws/server.js';

export type App = {
  port: number;
  service: RoomService;
  close(): Promise<void>;
};

/** Wires config → storage → room service → WebSocket server, and starts listening. */
export async function startApp(config: Config, logger: Logger): Promise<App> {
  let store: RoomStore;
  let healthCheck: HealthCheck | undefined;
  let closeStorage = () => Promise.resolve();

  if (config.databaseUrl) {
    const pool = createPool(config.databaseUrl, config.databasePoolMax, logger);
    closeStorage = () => pool.end();
    try {
      await pool.query('SELECT 1');
      if (config.migrateOnStart) await migrate(pool, logger);
      store = new PostgresRoomStore(pool);
      const pruned = await store.pruneIdleRooms(
        new Date(Date.now() - config.roomIdleTtlMs),
      );
      if (pruned > 0) logger.info({ pruned }, 'Pruned idle rooms');
    } catch (err) {
      await closeStorage();
      throw err;
    }
    healthCheck = async () => {
      await pool.query('SELECT 1');
      return true;
    };
    logger.info('Using PostgreSQL storage');
  } else {
    store = new MemoryRoomStore();
    logger.warn('DATABASE_URL is not set: rooms are kept in memory only');
  }

  const service = new RoomService(store, logger);
  const server = createSyncServer({
    service,
    logger,
    ...(healthCheck ? { healthCheck } : {}),
  });
  const address = await server.listen(config.port, config.host);
  logger.info({ host: config.host, port: address.port }, 'Server listening');

  return {
    port: address.port,
    service,
    async close() {
      await server.close();
      await closeStorage();
    },
  };
}
