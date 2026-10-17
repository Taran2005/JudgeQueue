import { HELLO_WORLD_OUTPUT, LANGUAGES } from '@judgequeue/shared';
import type { LanguageSpec, Logger } from '@judgequeue/shared';
import type { BoxPool } from './boxPool.js';
import { compileSource, executeProgram, runLimits } from './judge.js';
import type { Sandbox } from './isolate.js';
import { outputsMatch } from './compare.js';

const HELLO_PROBLEM = { time_limit_ms: 5000, memory_limit_kb: 262_144 };

async function checkLanguage(sandbox: Sandbox, spec: LanguageSpec, outputLimitKb: number): Promise<void> {
  await sandbox.init();
  try {
    if (!(await compileSource(sandbox, spec, spec.helloWorld))) throw new Error('hello world did not compile');
    const run = await executeProgram(sandbox, spec, runLimits(spec, HELLO_PROBLEM, outputLimitKb), '');
    if (run.failure) throw new Error(`hello world ended with ${run.failure}`);
    if (!outputsMatch(run.output, HELLO_WORLD_OUTPUT)) throw new Error(`unexpected output ${JSON.stringify(run.output)}`);
  } finally {
    await sandbox.cleanup();
  }
}

export interface HealthCheckDeps {
  boxPool: BoxPool;
  createSandbox(boxId: number): Sandbox;
  outputLimitKb: number;
  log: Logger;
}

export async function runStartupChecks(deps: HealthCheckDeps): Promise<void> {
  const boxId = await deps.boxPool.acquire();
  try {
    for (const spec of Object.values(LANGUAGES)) {
      try {
        await checkLanguage(deps.createSandbox(boxId), spec, deps.outputLimitKb);
      } catch (err) {
        throw new Error(`health check failed for ${spec.id}: ${(err as Error).message}`);
      }
      deps.log.info({ language: spec.id }, 'language health check passed');
    }
  } finally {
    deps.boxPool.release(boxId);
  }
}
