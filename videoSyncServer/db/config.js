/**
 * Database Configuration Module
 * Manages PostgreSQL connection pool
 */

require('dotenv').config();
const { Pool } = require('pg');

// Create connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 10, // Maximum number of connections in pool
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 2000, // Connection timeout
});

// Error handling
pool.on('error', (err) => {
  console.error('Unexpected error on idle client:', err);
});

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('✗ Database connection failed:', err.message);
    process.exit(1);
  } else {
    console.log('✓ Database connected successfully at', res.rows[0].now);
  }
});

/**
 * Execute a query with parameters
 * @param {string} text - SQL query with $1, $2, etc. placeholders
 * @param {array} params - Query parameters
 * @returns {Promise<any>} Query result
 */
async function query(text, params = []) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log(`[DB Query] ${duration}ms | ${text.substring(0, 80)}...`);
    return res;
  } catch (err) {
    console.error('[DB Error]', err.message);
    throw err;
  }
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<PoolClient>} Database client
 */
async function getClient() {
  return pool.connect();
}

/**
 * Close the connection pool
 * @returns {Promise<void>}
 */
async function close() {
  await pool.end();
  console.log('✓ Database connection pool closed');
}

module.exports = {
  query,
  getClient,
  close,
  pool,
};
