import {
  JUDGE_QUEUE_NAME,
  createJudgeQueue,
  createLogger,
  createPool,
  redisConnection,
} from '@judgequeue/shared';
import type { JudgeJobData } from '@judgequeue/shared';
import { Worker } from 'bullmq';
import { BoxPool, boxIds } from './boxPool.js';
import { loadConfig } from './config.js';
import { runStartupChecks } from './healthcheck.js';
import { Sandbox } from './isolate.js';
import { createProcessor } from './processor.js';
import { startReconciler } from './reconciler.js';
import { Store } from './store.js';
import { TestCache } from './testCache.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger('worker', config.LOG_LEVEL);
  const pool = createPool(config.DATABASE_URL, log);
  const connection = redisConnection(config.REDIS_URL);
  const queue = createJudgeQueue(connection);

  const ids = boxIds(config.BOX_COUNT, config.BOX_ID_START);
  const boxPool = new BoxPool(ids);
  const createSandbox = (boxId: number): Sandbox => new Sandbox(config.ISOLATE_BIN, boxId, config.META_DIR);

  await Promise.all(ids.map((id) => createSandbox(id).cleanup()));
  await runStartupChecks({ boxPool, createSandbox, outputLimitKb: config.OUTPUT_LIMIT_KB, log });

  const store = new Store(pool);
  const processor = createProcessor({
    store,
    cache: new TestCache(config.CACHE_DIR, store, log),
    boxPool,
    createSandbox,
    outputLimitKb: config.OUTPUT_LIMIT_KB,
    log,
  });

  const worker = new Worker<JudgeJobData>(JUDGE_QUEUE_NAME, processor, {
    connection,
    concurrency: boxPool.size,
  });
  worker.on('failed', (job, err) => log.error({ err, jobId: job?.id }, 'job failed'));
  worker.on('error', (err) => log.error({ err }, 'worker error'));

  const stopReconciler = startReconciler(
    { pool, queue, log, stuckTimeoutMs: config.STUCK_TIMEOUT_MS, maxAttempts: config.MAX_ATTEMPTS },
    config.RECONCILE_INTERVAL_MS,
  );
  log.info({ boxes: ids, concurrency: boxPool.size }, 'worker ready');

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down');
    stopReconciler();
    await worker.close();
    await Promise.all([queue.close(), pool.end()]);
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  createLogger('worker').fatal({ err }, 'worker failed to start');
  process.exit(1);
});
