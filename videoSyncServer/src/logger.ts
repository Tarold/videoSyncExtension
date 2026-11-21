import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(level: string = process.env.LOG_LEVEL ?? 'info') {
  return pino({ level, base: { service: 'video-sync-server' } });
}
