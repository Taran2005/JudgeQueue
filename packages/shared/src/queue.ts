import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { CONTEXT_PRIORITY } from './domain.js';
import type { SubmissionContext } from './domain.js';

export const JUDGE_QUEUE_NAME = 'judge';

export interface JudgeJobData {
  submissionId: string;
  judgeVersion: number;
}

export interface EnqueueRequest extends JudgeJobData {
  attempts: number;
  context: SubmissionContext;
}

/**
 * The first judging of a submission uses the submission id verbatim. Rejudges and
 * reconciler retries need fresh ids because BullMQ ignores a duplicate jobId.
 */
export function judgeJobId(submissionId: string, judgeVersion: number, attempts: number): string {
  if (judgeVersion === 1 && attempts === 0) return submissionId;
  return `${submissionId}-v${judgeVersion}-a${attempts}`;
}

export function redisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db,
    maxRetriesPerRequest: null,
  };
}

export function createJudgeQueue(connection: ConnectionOptions): Queue<JudgeJobData> {
  return new Queue<JudgeJobData>(JUDGE_QUEUE_NAME, {
    connection,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 1 },
  });
}

export async function enqueueJudgeJob(
  queue: Queue<JudgeJobData>,
  request: EnqueueRequest,
): Promise<void> {
  const { submissionId, judgeVersion, attempts, context } = request;
  await queue.add(
    'judge',
    { submissionId, judgeVersion },
    {
      jobId: judgeJobId(submissionId, judgeVersion, attempts),
      priority: CONTEXT_PRIORITY[context],
    },
  );
}
