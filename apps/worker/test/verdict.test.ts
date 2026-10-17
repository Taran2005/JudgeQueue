import { describe, expect, it } from 'vitest';
import { parseMeta } from '../src/meta.js';
import type { IsolateMeta } from '../src/meta.js';
import { compileSucceeded, runFailure } from '../src/verdict.js';

const LIMIT_KB = 262_144;

function meta(overrides: Partial<IsolateMeta> = {}): IsolateMeta {
  return { oomKilled: false, timeMs: 10, wallMs: 12, memoryKb: 2048, ...overrides };
}

describe('runFailure', () => {
  it('lets a clean exit through to output comparison', () => {
    expect(runFailure(meta({ exitCode: 0 }), LIMIT_KB)).toBeUndefined();
    expect(runFailure(meta(), LIMIT_KB)).toBeUndefined();
  });

  it('maps a timeout to TLE', () => {
    expect(runFailure(meta({ status: 'TO' }), LIMIT_KB)).toBe('TLE');
  });

  it('maps a cgroup oom kill to MLE even though it also looks like a signal', () => {
    expect(runFailure(meta({ status: 'SG', exitSignal: 9, oomKilled: true }), LIMIT_KB)).toBe('MLE');
  });

  it('maps SIGKILL at the memory limit to MLE', () => {
    expect(runFailure(meta({ status: 'SG', exitSignal: 9, memoryKb: LIMIT_KB }), LIMIT_KB)).toBe('MLE');
  });

  it('treats SIGKILL well below the limit as a runtime error', () => {
    expect(runFailure(meta({ status: 'SG', exitSignal: 9, memoryKb: 1024 }), LIMIT_KB)).toBe('RE');
  });

  it('maps a non-zero exit to RE', () => {
    expect(runFailure(meta({ status: 'RE', exitCode: 1 }), LIMIT_KB)).toBe('RE');
    expect(runFailure(meta({ exitCode: 3 }), LIMIT_KB)).toBe('RE');
  });

  it('maps a fatal signal to RE', () => {
    expect(runFailure(meta({ status: 'SG', exitSignal: 11 }), LIMIT_KB)).toBe('RE');
  });

  it('maps an isolate internal failure to IE', () => {
    expect(runFailure(meta({ status: 'XX' }), LIMIT_KB)).toBe('IE');
  });

  it('prefers IE over every other signal', () => {
    expect(runFailure(meta({ status: 'XX', oomKilled: true }), LIMIT_KB)).toBe('IE');
  });
});

describe('compileSucceeded', () => {
  it('accepts a clean compile', () => {
    expect(compileSucceeded(meta({ exitCode: 0 }))).toBe(true);
  });

  it.each([
    ['non-zero exit', meta({ status: 'RE', exitCode: 1 })],
    ['timeout', meta({ status: 'TO' })],
    ['signal', meta({ status: 'SG', exitSignal: 9 })],
  ])('rejects %s', (_name, value) => {
    expect(compileSucceeded(value)).toBe(false);
  });
});

describe('parseMeta', () => {
  it('reads an isolate meta file', () => {
    const parsed = parseMeta(
      ['time:0.123', 'time-wall:0.456', 'max-rss:3200', 'cg-mem:4100', 'exitcode:1', 'status:RE', 'message:Exited with error status 1'].join('\n'),
    );
    expect(parsed).toMatchObject({ status: 'RE', exitCode: 1, timeMs: 123, wallMs: 456, memoryKb: 4100 });
    expect(parsed.message).toBe('Exited with error status 1');
  });

  it('flags the cgroup oom marker', () => {
    expect(parseMeta('cg-oom-killed:1\nstatus:SG\nexitsig:9\n').oomKilled).toBe(true);
  });

  it('treats an unknown status as an internal error', () => {
    expect(parseMeta('status:WAT\n').status).toBe('XX');
  });

  it('defaults a missing status to a clean run', () => {
    expect(parseMeta('time:0.001\n').status).toBeUndefined();
  });
});
