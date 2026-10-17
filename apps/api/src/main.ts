import {
  createJudgeQueue,
  createLogger,
  createPool,
  enqueueJudgeJob,
  redisConnection,
  runMigrations,
  seedProblems,
} from '@judgequeue/shared';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { PgSubmissionRepo } from './repo.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger('api', config.LOG_LEVEL);
  const pool = createPool(config.DATABASE_URL, log);
  const queue = createJudgeQueue(redisConnection(config.REDIS_URL));

  if (config.AUTO_MIGRATE) await runMigrations(pool, config.MIGRATIONS_DIR, log);
  if (config.AUTO_SEED) await seedProblems(pool, config.PROBLEMS_DIR, log);

  const app = createApp({
    repo: new PgSubmissionRepo(pool),
    enqueue: (request) => enqueueJudgeJob(queue, request),
    checkReady: async () => {
      await pool.query('SELECT 1');
      await queue.getJobCounts('waiting');
    },
    log,
  });

  const server = app.listen(config.PORT, () => log.info({ port: config.PORT }, 'api listening'));

  const shutdown = (signal: string): void => {
    log.info({ signal }, 'shutting down');
    server.close(() => {
      void Promise.all([queue.close(), pool.end()]).then(() => process.exit(0));
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  createLogger('api').fatal({ err }, 'api failed to start');
  process.exit(1);
});
