import WebSocket from 'ws';
import type { ServerMessage } from '../src/protocol.js';

const DEFAULT_TIMEOUT_MS = 2_000;

/**
 * Minimal scripted client speaking the extension's protocol. Used by the integration tests
 * and by scripts/smoke.ts.
 */
export class TestClient {
  readonly received: ServerMessage[] = [];
  private cursor = 0;
  private waiters: (() => void)[] = [];

  private constructor(
    private readonly socket: WebSocket,
    readonly userId: string,
  ) {
    socket.on('message', (data: Buffer) => {
      this.received.push(JSON.parse(data.toString('utf8')) as ServerMessage);
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  static connect(url: string, userId: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.once('open', () => {
        resolve(new TestClient(socket, userId));
      });
      socket.once('error', reject);
    });
  }

  /** Sends a message with this client's userId, like service_worker.js does. */
  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify({ userId: this.userId, ...message }));
  }

  sendRaw(raw: string): void {
    this.socket.send(raw);
  }

  /** Resolves with the next unread message of the given action, skipping others. */
  async next<A extends ServerMessage['action']>(
    action: A,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<Extract<ServerMessage, { action: A }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (this.cursor < this.received.length) {
        const message = this.received[this.cursor++];
        if (message?.action === action) {
          return message as Extract<ServerMessage, { action: A }>;
        }
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`${this.userId}: timed out waiting for "${action}"`);
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** Asserts nothing new of this action arrives within the window. */
  async expectNone(
    action: ServerMessage['action'],
    windowMs = 200,
  ): Promise<void> {
    try {
      const message = await this.next(action, windowMs);
      throw new Error(
        `${this.userId}: unexpected "${action}": ${JSON.stringify(message)}`,
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('timed out')) return;
      throw err;
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.socket.once('close', () => {
        resolve();
      });
      this.socket.close();
    });
  }
}
