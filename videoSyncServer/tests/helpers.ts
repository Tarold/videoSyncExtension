import { pino } from 'pino';
import type { Connection } from '../src/domain/room.js';
import type { ServerMessage } from '../src/protocol.js';

export const silentLogger = pino({ level: 'silent' });

/** Records every message the server sends to it. */
export class FakeConnection implements Connection {
  isOpen = true;
  readonly messages: ServerMessage[] = [];

  send(message: ServerMessage): void {
    this.messages.push(message);
  }

  last(): ServerMessage | undefined {
    return this.messages.at(-1);
  }

  ofType<A extends ServerMessage['action']>(
    action: A,
  ): Extract<ServerMessage, { action: A }>[] {
    return this.messages.filter(
      (m): m is Extract<ServerMessage, { action: A }> => m.action === action,
    );
  }

  clear(): void {
    this.messages.length = 0;
  }
}

/** Deterministic `Math.random` replacement cycling through the given values. */
export function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}
