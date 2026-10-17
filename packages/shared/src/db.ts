import pg from 'pg';
import type { Logger } from './logger.js';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(connectionString: string, log: Logger, max = 10): Pool {
  const pool = new pg.Pool({ connectionString, max });
  pool.on('error', (err) => log.error({ err }, 'idle postgres client error'));
  return pool;
}
