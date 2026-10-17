import { isFinalStatus } from '@judgequeue/shared';
import type { JudgeJobData, Logger } from '@judgequeue/shared';
import type { Job } from 'bullmq';
import type { BoxPool } from './boxPool.js';
import { judgeSubmission } from './judge.js';
import type { JudgeOutcome } from './judge.js';
import type { Sandbox } from './isolate.js';
import type { Store } from './store.js';
import type { TestCache } from './testCache.js';

export interface ProcessorDeps {
  store: Store;
  cache: TestCache;
  boxPool: BoxPool;
  createSandbox(boxId: number): Sandbox;
  outputLimitKb: number;
  log: Logger;
}

class StaleJudgeError extends Error {}

const INTERNAL_ERROR: JudgeOutcome = { verdict: 'IE', timeMs: 0, memoryKb: 0, failedTest: null };

async function cleanupBox(sandbox: Sandbox, log: Logger): Promise<void> {
  try {
    await sandbox.cleanup();
  } catch (err) {
    log.error({ err, boxId: sandbox.boxId }, 'box cleanup failed');
  }
}

export function createProcessor(deps: ProcessorDeps): (job: Job<JudgeJobData>) => Promise<void> {
  const { store, cache, boxPool, createSandbox, outputLimitKb } = deps;

  async function advance(job: JudgeJobData, status: 'COMPILING' | 'RUNNING'): Promise<void> {
    if (!(await store.advanceStatus(job.submissionId, job.judgeVersion, status))) throw new StaleJudgeError();
  }

  async function runJob(job: JudgeJobData, log: Logger): Promise<void> {
    const submission = await store.getSubmission(job.submissionId);
    if (!submission || submission.judge_version !== job.judgeVersion || isFinalStatus(submission.status)) {
      log.info('skipping stale job');
      return;
    }
    const problem = await store.getProblem(submission.problem_id);
    if (!problem) {
      await store.writeVerdict(job.submissionId, job.judgeVersion, INTERNAL_ERROR);
      log.error({ problemId: submission.problem_id }, 'problem missing');
      return;
    }
    const tests = await cache.ensure(problem.id, problem.test_version);

    const boxId = await boxPool.acquire();
    const sandbox = createSandbox(boxId);
    const boxLog = log.child({ boxId });
    try {
      await sandbox.init();
      await advance(job, 'COMPILING');
      const outcome = await judgeSubmission(
        sandbox,
        { submission, problem, tests, outputLimitKb },
        { onCompiled: () => advance(job, 'RUNNING') },
      );
      await store.writeVerdict(job.submissionId, job.judgeVersion, outcome);
      boxLog.info({ verdict: outcome.verdict, timeMs: outcome.timeMs, failedTest: outcome.failedTest }, 'judged');
    } catch (err) {
      if (err instanceof StaleJudgeError) {
        boxLog.info('job went stale while judging');
      } else {
        boxLog.error({ err }, 'internal judge failure');
        await store.writeVerdict(job.submissionId, job.judgeVersion, INTERNAL_ERROR);
      }
    } finally {
      await cleanupBox(sandbox, boxLog);
      boxPool.release(boxId);
    }
  }

  return async (job) => {
    const log = deps.log.child({ submissionId: job.data.submissionId, judgeVersion: job.data.judgeVersion });
    await runJob(job.data, log);
  };
}
