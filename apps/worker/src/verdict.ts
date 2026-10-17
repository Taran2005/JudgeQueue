import type { Verdict } from '@judgequeue/shared';
import type { IsolateMeta } from './meta.js';

export type RunFailure = Extract<Verdict, 'TLE' | 'MLE' | 'RE' | 'IE'>;

const SIGKILL = 9;

function killedForMemory(meta: IsolateMeta, memoryLimitKb: number): boolean {
  if (meta.oomKilled) return true;
  // Some kernels report the cgroup kill only as SIGKILL, with usage pinned at the limit.
  return meta.status === 'SG' && meta.exitSignal === SIGKILL && meta.memoryKb >= memoryLimitKb;
}

/** Maps how the program ended; undefined means it exited cleanly and the output still needs checking. */
export function runFailure(meta: IsolateMeta, memoryLimitKb: number): RunFailure | undefined {
  if (meta.status === 'XX') return 'IE';
  if (killedForMemory(meta, memoryLimitKb)) return 'MLE';
  if (meta.status === 'TO') return 'TLE';
  if (meta.status === 'SG' || meta.status === 'RE') return 'RE';
  if ((meta.exitCode ?? 0) !== 0) return 'RE';
  return undefined;
}

export function compileSucceeded(meta: IsolateMeta): boolean {
  return meta.status === undefined && (meta.exitCode ?? 0) === 0;
}
