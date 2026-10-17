import { createLogger, createPool, parseEnv, runMigrations } from '@judgequeue/shared';
import { z } from 'zod';

const env = parseEnv(
  z.object({
    DATABASE_URL: z.string().url(),
    MIGRATIONS_DIR: z.string().default('db/migrations'),
  }),
);

const log = createLogger('migrate');
const pool = createPool(env.DATABASE_URL, log, 2);
try {
  const ran = await runMigrations(pool, env.MIGRATIONS_DIR, log);
  log.info({ applied: ran.length }, 'migrations complete');
} finally {
  await pool.end();
}
