import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { Connection } from '../domain/room.js';
import type { RoomService } from '../domain/room-service.js';
import type { Logger } from '../logger.js';
import {
  type ClientMessage,
  type ServerMessage,
  parseClientMessage,
} from '../protocol.js';

const MAX_PAYLOAD_BYTES = 64 * 1024;
const HEARTBEAT_INTERVAL_MS = 30_000;

export type HealthCheck = () => Promise<boolean>;

export type SyncServerOptions = {
  service: RoomService;
  logger: Logger;
  /** Extra readiness probe (e.g. a database ping) reported by GET /health. */
  healthCheck?: HealthCheck;
};

export type SyncServer = {
  listen(port: number, host?: string): Promise<AddressInfo>;
  close(): Promise<void>;
};

/** Per-socket state: which room it joined and a queue keeping its messages in order. */
class ClientSession implements Connection {
  roomId: string | null = null;
  userId: string | null = null;
  alive = true;
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly socket: WebSocket) {}

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send(message: ServerMessage): void {
    if (this.isOpen) this.socket.send(JSON.stringify(message));
  }

  enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task);
    return this.queue;
  }
}

export function createSyncServer({
  service,
  logger,
  healthCheck,
}: SyncServerOptions): SyncServer {
  let shuttingDown = false;
  const httpServer = createServer((req, res) => {
    void handleHttp(req, res);
  });
  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: MAX_PAYLOAD_BYTES,
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET' && req.url === '/health') {
      let database: boolean;
      try {
        database = healthCheck ? await healthCheck() : true;
      } catch {
        database = false;
      }
      const ok = database && !shuttingDown;
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: ok ? 'ok' : 'unavailable',
          rooms: service.roomCount,
          connections: wss.clients.size,
        }),
      );
      return;
    }
    res.writeHead(404).end();
  }

  async function handleMessage(session: ClientSession, message: ClientMessage) {
    session.userId = message.userId;
    logger.debug(
      { action: message.action, userId: message.userId },
      'Received',
    );

    switch (message.action) {
      case 'create-room': {
        await leaveCurrentRoom(session);
        const room = await service.createRoom(
          message.userId,
          session,
          message.payload?.url,
        );
        if (room) session.roomId = room.id;
        break;
      }
      case 'join-room': {
        if (session.roomId !== message.roomId) await leaveCurrentRoom(session);
        const room = await service.joinRoom(
          message.roomId,
          message.userId,
          session,
        );
        if (room) session.roomId = room.id;
        break;
      }
      case 'leave-room':
        await leaveCurrentRoom(session);
        break;
      case 'get-state':
        service.getState(message.roomId, session);
        break;
      case 'video-update':
        service.videoUpdate(
          message.roomId,
          message.userId,
          message.payload,
          session,
        );
        break;
      case 'update-settings':
        await service.updateSettings(
          message.roomId,
          message.userId,
          message.payload.settings,
          session,
        );
        break;
    }
  }

  async function leaveCurrentRoom(session: ClientSession) {
    const { roomId, userId } = session;
    session.roomId = null;
    if (roomId && userId) await service.leaveRoom(roomId, userId, session);
  }

  const sessions = new WeakMap<WebSocket, ClientSession>();

  wss.on('connection', (socket) => {
    const session = new ClientSession(socket);
    sessions.set(socket, session);
    socket.on('pong', () => {
      session.alive = true;
    });

    socket.on('message', (data: RawData) => {
      const parsed = parseClientMessage(rawToString(data));
      if (!parsed.ok) {
        logger.warn({ error: parsed.error }, 'Rejected client message');
        session.send({ action: 'error', message: parsed.error });
        return;
      }
      void session
        .enqueue(() => handleMessage(session, parsed.message))
        .catch((err: unknown) => {
          logger.error({ err }, 'Unhandled error while processing message');
        });
    });

    socket.on('close', () => {
      if (shuttingDown) return; // keep rooms persisted so clients can rejoin after restart
      void session
        .enqueue(() => leaveCurrentRoom(session))
        .catch((err: unknown) => {
          logger.error({ err }, 'Failed to clean up closed connection');
        });
    });
  });

  // Drop sockets that stopped answering pings (e.g. a suspended MV3 service worker).
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const session = sessions.get(socket);
      if (session && !session.alive) {
        socket.terminate();
        continue;
      }
      if (session) session.alive = false;
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return {
    listen(port, host) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          resolve(httpServer.address() as AddressInfo);
        });
      });
    },
    async close() {
      shuttingDown = true;
      clearInterval(heartbeat);
      service.detachAll();
      for (const socket of wss.clients)
        socket.close(1001, 'Server shutting down');
      await new Promise<void>((resolve) => {
        wss.close(() => {
          resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
