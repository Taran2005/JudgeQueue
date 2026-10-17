import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LANGUAGES } from '@judgequeue/shared';
import { judgeSubmission, runCommand, runLimits } from '../src/judge.js';
import type { JudgeInput } from '../src/judge.js';
import { SandboxFileError } from '../src/isolate.js';
import type { JudgeSandbox, RunSpec } from '../src/isolate.js';
import type { IsolateMeta } from '../src/meta.js';
import type { CachedTest } from '../src/testCache.js';

const clean: IsolateMeta = { oomKilled: false, timeMs: 20, wallMs: 25, memoryKb: 4096, exitCode: 0 };

class FakeSandbox implements JudgeSandbox {
  readonly files = new Map<string, string>();
  readonly runs: RunSpec[] = [];
  constructor(private readonly script: Array<{ meta: IsolateMeta; output?: string }>) {}

  async writeFile(name: string, data: string | Buffer): Promise<void> {
    this.files.set(name, data.toString());
  }
  async removeFile(name: string): Promise<void> {
    this.files.delete(name);
  }
  async readOutput(name: string): Promise<string> {
    const value = this.files.get(name);
    if (value === undefined) throw new SandboxFileError('missing');
    return value;
  }
  async run(spec: RunSpec): Promise<IsolateMeta> {
    const step = this.script[this.runs.length];
    this.runs.push(spec);
    if (!step) throw new Error('unexpected run');
    if (step.output !== undefined) this.files.set(spec.stdout, step.output);
    return step.meta;
  }
}

describe('judgeSubmission', () => {
  let dir: string;
  let tests: CachedTest[];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'judge-test-'));
    tests = await Promise.all(
      [1, 2, 3].map(async (ordinal) => {
        const inputPath = join(dir, `${ordinal}.in`);
        const expectedPath = join(dir, `${ordinal}.out`);
        await writeFile(inputPath, `${ordinal}\n`);
        await writeFile(expectedPath, `${ordinal * 2}\n`);
        return { ordinal, inputPath, expectedPath };
      }),
    );
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  const input = (): JudgeInput => ({
    submission: { language: 'cpp', code: 'int main(){}' },
    problem: { time_limit_ms: 1000, memory_limit_kb: 262_144 },
    tests,
    outputLimitKb: 1024,
  });

  const hooks = () => ({ onCompiled: vi.fn(async () => undefined) });

  it('returns CE without running any test when the compile fails', async () => {
    const sandbox = new FakeSandbox([{ meta: { ...clean, status: 'RE', exitCode: 1 } }]);
    const h = hooks();
    const outcome = await judgeSubmission(sandbox, input(), h);
    expect(outcome).toEqual({ verdict: 'CE', timeMs: 0, memoryKb: 0, failedTest: null });
    expect(sandbox.runs).toHaveLength(1);
    expect(h.onCompiled).not.toHaveBeenCalled();
  });

  it('accepts when every test matches and reports the worst time and memory', async () => {
    const sandbox = new FakeSandbox([
      { meta: clean },
      { meta: { ...clean, timeMs: 30, memoryKb: 5000 }, output: '2\n' },
      { meta: { ...clean, timeMs: 90, memoryKb: 4000 }, output: '4' },
      { meta: { ...clean, timeMs: 10, memoryKb: 9000 }, output: '6  \n' },
    ]);
    expect(await judgeSubmission(sandbox, input(), hooks())).toEqual({
      verdict: 'AC',
      timeMs: 90,
      memoryKb: 9000,
      failedTest: null,
    });
  });

  it('stops at the first wrong answer and never runs later tests', async () => {
    const sandbox = new FakeSandbox([
      { meta: clean },
      { meta: clean, output: '2\n' },
      { meta: clean, output: '999\n' },
    ]);
    const outcome = await judgeSubmission(sandbox, input(), hooks());
    expect(outcome).toMatchObject({ verdict: 'WA', failedTest: 2 });
    expect(sandbox.runs).toHaveLength(3);
  });

  it.each([
    ['TLE', { ...clean, status: 'TO' as const }],
    ['RE', { ...clean, status: 'SG' as const, exitSignal: 11 }],
    ['MLE', { ...clean, status: 'SG' as const, exitSignal: 9, oomKilled: true }],
  ])('reports %s from the first test', async (verdict, meta) => {
    const sandbox = new FakeSandbox([{ meta: clean }, { meta }]);
    expect(await judgeSubmission(sandbox, input(), hooks())).toMatchObject({ verdict, failedTest: 1 });
  });

  it('only ever places the current test input in the box', async () => {
    const sandbox = new FakeSandbox([{ meta: clean }, { meta: clean, output: 'x' }]);
    await judgeSubmission(sandbox, input(), hooks());
    expect(sandbox.files.get('input.txt')).toBe('1\n');
    expect([...sandbox.files.values()].some((value) => value.includes('2\n') && value !== '2\n')).toBe(false);
  });

  it('treats an unreadable output file as a runtime error', async () => {
    const sandbox = new FakeSandbox([{ meta: clean }, { meta: clean }]);
    expect(await judgeSubmission(sandbox, input(), hooks())).toMatchObject({ verdict: 'RE', failedTest: 1 });
  });

  it('raises on a sandbox failure so the worker records IE', async () => {
    const sandbox = new FakeSandbox([{ meta: clean }, { meta: { ...clean, status: 'XX' as const } }]);
    await expect(judgeSubmission(sandbox, input(), hooks())).rejects.toThrow(/sandbox failure/);
  });
});

describe('run configuration', () => {
  const problem = { time_limit_ms: 1000, memory_limit_kb: 65_536 };

  it('scales the time limit by the language multiplier', () => {
    expect(runLimits(LANGUAGES.python, problem, 1024).cpuSec).toBe(3);
    expect(runLimits(LANGUAGES.cpp, problem, 1024).cpuSec).toBe(1);
  });

  it('gives wall time headroom over cpu time', () => {
    const limits = runLimits(LANGUAGES.cpp, problem, 1024);
    expect(limits.wallSec).toBeGreaterThan(limits.cpuSec);
  });

  it('raises the memory limit to the language floor', () => {
    expect(runLimits(LANGUAGES.java, problem, 1024).memoryKb).toBe(LANGUAGES.java.memoryLimitKb);
    expect(runLimits(LANGUAGES.cpp, { ...problem, memory_limit_kb: 262_144 }, 1024).memoryKb).toBe(262_144);
  });

  it('gives java a higher process cap than the other languages', () => {
    expect(LANGUAGES.java.processLimit).toBeGreaterThan(LANGUAGES.cpp.processLimit);
    expect(LANGUAGES.java.processLimit).toBeGreaterThan(LANGUAGES.python.processLimit);
  });

  it('substitutes the heap size into the java command', () => {
    expect(runCommand(LANGUAGES.java, 524_288)).toContain('-Xmx512m');
  });
});
