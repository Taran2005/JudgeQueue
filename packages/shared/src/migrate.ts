import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool, PoolClient } from './db.js';
import type { Logger } from './logger.js';

const MIGRATION_LOCK_ID = 727_274;

async function applyMigration(client: PoolClient, dir: string, name: string): Promise<void> {
  const sql = await readFile(join(dir, name), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

export async function runMigrations(pool: Pool, dir: string, log: Logger): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const applied = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(applied.rows.map((row) => row.name));
    const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();

    const ran: string[] = [];
    for (const file of files.filter((f) => !done.has(f))) {
      await applyMigration(client, dir, file);
      log.info({ migration: file }, 'migration applied');
      ran.push(file);
    }
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
