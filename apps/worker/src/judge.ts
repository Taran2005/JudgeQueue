import { languageSpec } from '@judgequeue/shared';
import type { LanguageSpec, ProblemRow, SubmissionRow, Verdict } from '@judgequeue/shared';
import { readFile } from 'node:fs/promises';
import { outputsMatch } from './compare.js';
import { SandboxFileError } from './isolate.js';
import type { JudgeSandbox, RunLimits } from './isolate.js';
import type { IsolateMeta } from './meta.js';
import type { CachedTest } from './testCache.js';
import { compileSucceeded, runFailure } from './verdict.js';

export interface JudgeOutcome {
  verdict: Verdict;
  timeMs: number;
  memoryKb: number;
  failedTest: number | null;
}

export interface JudgeInput {
  submission: Pick<SubmissionRow, 'language' | 'code'>;
  problem: Pick<ProblemRow, 'time_limit_ms' | 'memory_limit_kb'>;
  tests: readonly CachedTest[];
  outputLimitKb: number;
}

export interface JudgeHooks {
  onCompiled(): Promise<void>;
}

export class JudgeInternalError extends Error {}

const INPUT_FILE = 'input.txt';
const OUTPUT_FILE = 'output.txt';
const STDERR_FILE = 'stderr.txt';
const COMPILE_LOG_FILE = 'compile.log';
const WALL_FACTOR = 2;
const WALL_SLACK_SEC = 1;

export function runLimits(
  spec: LanguageSpec,
  problem: JudgeInput['problem'],
  outputLimitKb: number,
): RunLimits {
  const cpuSec = (problem.time_limit_ms / 1000) * spec.timeMultiplier;
  return {
    cpuSec,
    wallSec: cpuSec * WALL_FACTOR + WALL_SLACK_SEC,
    memoryKb: Math.max(problem.memory_limit_kb, spec.memoryLimitKb),
    processes: spec.processLimit,
    fsizeKb: outputLimitKb,
  };
}

export function runCommand(spec: LanguageSpec, memoryKb: number): string[] {
  const memoryMb = String(Math.floor(memoryKb / 1024));
  return spec.run.map((part) => part.replace('{memoryMb}', memoryMb));
}

export async function compileSource(sandbox: JudgeSandbox, spec: LanguageSpec, code: string): Promise<boolean> {
  await sandbox.writeFile(spec.sourceFile, code);
  const meta = await sandbox.run({
    command: spec.compile,
    limits: spec.compileLimits,
    stdout: COMPILE_LOG_FILE,
    stderr: COMPILE_LOG_FILE,
  });
  if (meta.status === 'XX') throw new JudgeInternalError(`compile sandbox failure: ${meta.message ?? 'unknown'}`);
  return compileSucceeded(meta);
}

export interface Execution {
  meta: IsolateMeta;
  failure: Verdict | undefined;
  output: string;
}

export async function executeProgram(
  sandbox: JudgeSandbox,
  spec: LanguageSpec,
  limits: RunLimits,
  input: string,
): Promise<Execution> {
  await Promise.all([INPUT_FILE, OUTPUT_FILE, STDERR_FILE].map((name) => sandbox.removeFile(name)));
  await sandbox.writeFile(INPUT_FILE, input);
  const meta = await sandbox.run({
    command: runCommand(spec, limits.memoryKb),
    limits,
    stdin: INPUT_FILE,
    stdout: OUTPUT_FILE,
    stderr: STDERR_FILE,
  });

  const failure = runFailure(meta, limits.memoryKb);
  if (failure) return { meta, failure, output: '' };
  try {
    return { meta, failure: undefined, output: await sandbox.readOutput(OUTPUT_FILE, limits.fsizeKb * 1024) };
  } catch (err) {
    if (err instanceof SandboxFileError) return { meta, failure: 'RE', output: '' };
    throw err;
  }
}

export async function judgeSubmission(
  sandbox: JudgeSandbox,
  input: JudgeInput,
  hooks: JudgeHooks,
): Promise<JudgeOutcome> {
  const spec = languageSpec(input.submission.language);
  if (!(await compileSource(sandbox, spec, input.submission.code))) {
    return { verdict: 'CE', timeMs: 0, memoryKb: 0, failedTest: null };
  }
  await hooks.onCompiled();

  const limits = runLimits(spec, input.problem, input.outputLimitKb);
  let timeMs = 0;
  let memoryKb = 0;

  for (const test of input.tests) {
    const [stdin, expected] = await Promise.all([
      readFile(test.inputPath, 'utf8'),
      readFile(test.expectedPath, 'utf8'),
    ]);
    const run = await executeProgram(sandbox, spec, limits, stdin);
    timeMs = Math.max(timeMs, run.meta.timeMs);
    memoryKb = Math.max(memoryKb, run.meta.memoryKb);

    const verdict = run.failure ?? (outputsMatch(run.output, expected) ? 'AC' : 'WA');
    if (verdict !== 'AC') {
      if (verdict === 'IE') throw new JudgeInternalError(`run sandbox failure: ${run.meta.message ?? 'unknown'}`);
      return { verdict, timeMs, memoryKb, failedTest: test.ordinal };
    }
  }
  return { verdict: 'AC', timeMs, memoryKb, failedTest: null };
}
