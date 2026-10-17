import { describe, expect, it } from 'vitest';
import { buildRunArgs } from '../src/isolate.js';
import type { RunSpec } from '../src/isolate.js';

const spec: RunSpec = {
  command: ['./main'],
  limits: { cpuSec: 1.5, wallSec: 4, memoryKb: 262_144, processes: 1, fsizeKb: 16_384 },
  stdin: 'input.txt',
  stdout: 'output.txt',
  stderr: 'stderr.txt',
};

describe('buildRunArgs', () => {
  const args = buildRunArgs(3, '/tmp/box-3.meta', spec);

  it('applies every limit and uses cgroups for memory', () => {
    expect(args).toEqual(
      expect.arrayContaining([
        '--box-id=3',
        '--cg',
        '--time=1.500',
        '--wall-time=4.000',
        '--cg-mem=262144',
        '--processes=1',
        '--fsize=16384',
      ]),
    );
  });

  it('never grants network access', () => {
    expect(args).not.toContain('--share-net');
  });

  it('puts the command after the separator', () => {
    expect(args.slice(args.indexOf('--run'))).toEqual(['--run', '--', './main']);
  });

  it('omits stdin when none is given', () => {
    const { stdin: _stdin, ...withoutStdin } = spec;
    expect(buildRunArgs(0, '/tmp/m', withoutStdin).some((arg) => arg.startsWith('--stdin'))).toBe(false);
  });
});
