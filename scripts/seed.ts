import { createLogger, createPool, parseEnv, seedProblems } from '@judgequeue/shared';
import { z } from 'zod';

const env = parseEnv(
  z.object({
    DATABASE_URL: z.string().url(),
    PROBLEMS_DIR: z.string().default('problems'),
  }),
);

const log = createLogger('seed');
const pool = createPool(env.DATABASE_URL, log, 2);
try {
  await seedProblems(pool, env.PROBLEMS_DIR, log);
} finally {
  await pool.end();
}
