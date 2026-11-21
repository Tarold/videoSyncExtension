import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { migrate } from './migrate.js';
import { createPool } from './pool.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);

if (!config.databaseUrl) {
  logger.fatal('DATABASE_URL is not set');
  process.exit(1);
}

const pool = createPool(config.databaseUrl, 1, logger);
try {
  const applied = await migrate(pool, logger);
  logger.info({ applied: applied.length }, 'Migrations up to date');
} finally {
  await pool.end();
}
