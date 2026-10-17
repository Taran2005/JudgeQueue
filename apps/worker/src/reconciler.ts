import { IN_FLIGHT_STATUSES, enqueueJudgeJob, judgeJobId } from '@judgequeue/shared';
import type { JudgeJobData, Logger, Pool, SubmissionContext } from '@judgequeue/shared';
import type { Queue } from 'bullmq';

export interface ReconcilerDeps {
  pool: Pool;
  queue: Queue<JudgeJobData>;
  log: Logger;
  stuckTimeoutMs: number;
  maxAttempts: number;
}

interface StuckRow {
  id: string;
  judge_version: number;
  attempts: number;
  context: SubmissionContext;
}

export interface ReconcileResult {
  requeued: number;
  failed: number;
}

const BATCH_SIZE = 100;
const LIVE_JOB_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

async function findStuck(deps: ReconcilerDeps): Promise<StuckRow[]> {
  const result = await deps.pool.query<StuckRow>(
    `SELECT id, judge_version, attempts, context FROM submissions
     WHERE status = ANY($1::text[]) AND updated_at < now() - make_interval(secs => $2)
     ORDER BY updated_at LIMIT $3`,
    [IN_FLIGHT_STATUSES, deps.stuckTimeoutMs / 1000, BATCH_SIZE],
  );
  return result.rows;
}

/** A row can look stuck simply because it waits behind a long backlog, so the queue is the authority. */
async function hasLiveJob(queue: Queue<JudgeJobData>, row: StuckRow): Promise<boolean> {
  const job = await queue.getJob(judgeJobId(row.id, row.judge_version, row.attempts));
  return job !== undefined && LIVE_JOB_STATES.has(await job.getState());
}

async function markExhausted(deps: ReconcilerDeps, row: StuckRow): Promise<boolean> {
  const result = await deps.pool.query(
    `UPDATE submissions SET status = 'DONE', verdict = 'IE', updated_at = now()
     WHERE id = $1 AND judge_version = $2 AND attempts = $3 AND status = ANY($4::text[])`,
    [row.id, row.judge_version, row.attempts, IN_FLIGHT_STATUSES],
  );
  return result.rowCount === 1;
}

async function claimRetry(deps: ReconcilerDeps, row: StuckRow): Promise<boolean> {
  const result = await deps.pool.query(
    `UPDATE submissions SET attempts = attempts + 1, status = 'QUEUED', updated_at = now()
     WHERE id = $1 AND judge_version = $2 AND attempts = $3 AND status = ANY($4::text[])`,
    [row.id, row.judge_version, row.attempts, IN_FLIGHT_STATUSES],
  );
  return result.rowCount === 1;
}

async function reconcileRow(deps: ReconcilerDeps, row: StuckRow): Promise<keyof ReconcileResult | undefined> {
  if (await hasLiveJob(deps.queue, row)) return undefined;

  if (row.attempts >= deps.maxAttempts) {
    if (!(await markExhausted(deps, row))) return undefined;
    deps.log.warn({ submissionId: row.id, attempts: row.attempts }, 'submission exhausted its attempts');
    return 'failed';
  }
  if (!(await claimRetry(deps, row))) return undefined;

  const attempts = row.attempts + 1;
  await enqueueJudgeJob(deps.queue, {
    submissionId: row.id,
    judgeVersion: row.judge_version,
    attempts,
    context: row.context,
  });
  deps.log.warn({ submissionId: row.id, attempts }, 'stuck submission re-enqueued');
  return 'requeued';
}

export async function reconcileOnce(deps: ReconcilerDeps): Promise<ReconcileResult> {
  const result: ReconcileResult = { requeued: 0, failed: 0 };
  for (const row of await findStuck(deps)) {
    const outcome = await reconcileRow(deps, row);
    if (outcome) result[outcome] += 1;
  }
  return result;
}

export function startReconciler(deps: ReconcilerDeps, intervalMs: number): () => void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await reconcileOnce(deps);
    } catch (err) {
      deps.log.error({ err }, 'reconcile pass failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
