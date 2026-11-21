import { z } from 'zod';

const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  /** PostgreSQL connection string. Without it the server keeps rooms in memory only. */
  DATABASE_URL: z.url().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  MIGRATE_ON_START: booleanFromEnv.default(true),
  /** Persisted rooms with no activity for this long are pruned on startup. */
  ROOM_IDLE_TTL_HOURS: z.coerce.number().positive().default(24),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export type Config = {
  host: string;
  port: number;
  databaseUrl: string | undefined;
  databasePoolMax: number;
  migrateOnStart: boolean;
  roomIdleTtlMs: number;
  logLevel: (typeof LOG_LEVELS)[number];
};

const MS_PER_HOUR = 60 * 60 * 1000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings (e.g. `DATABASE_URL=` in a .env file) as unset.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  const parsed = result.data;
  return {
    host: parsed.HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    databasePoolMax: parsed.DATABASE_POOL_MAX,
    migrateOnStart: parsed.MIGRATE_ON_START,
    roomIdleTtlMs: parsed.ROOM_IDLE_TTL_HOURS * MS_PER_HOUR,
    logLevel: parsed.LOG_LEVEL,
  };
}
