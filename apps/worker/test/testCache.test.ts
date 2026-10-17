import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@judgequeue/shared';
import type { TestCaseRow } from '@judgequeue/shared';
import { TestCache } from '../src/testCache.js';

const tests: TestCaseRow[] = [
  { ordinal: 1, input: '1 2\n', expected_output: '3\n' },
  { ordinal: 2, input: '4 5\n', expected_output: '9\n' },
];

describe('TestCache', () => {
  let root: string;
  const fetchTests = vi.fn<(problemId: string) => Promise<TestCaseRow[]>>();
  let cache: TestCache;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'test-cache-'));
    fetchTests.mockReset().mockResolvedValue(tests);
    cache = new TestCache(root, { fetchTests }, createLogger('test', 'silent'));
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it('writes inputs and expected outputs to disk on a miss', async () => {
    const cached = await cache.ensure('a-plus-b', 1);
    expect(cached.map((test) => test.ordinal)).toEqual([1, 2]);
    expect(await readFile(cached[0]!.inputPath, 'utf8')).toBe('1 2\n');
    expect(await readFile(cached[1]!.expectedPath, 'utf8')).toBe('9\n');
  });

  it('serves a hit from disk without touching the source', async () => {
    await cache.ensure('a-plus-b', 1);
    const second = new TestCache(root, { fetchTests }, createLogger('test', 'silent'));
    await second.ensure('a-plus-b', 1);
    expect(fetchTests).toHaveBeenCalledTimes(1);
  });

  it('keys the cache on the test version', async () => {
    await cache.ensure('a-plus-b', 1);
    await cache.ensure('a-plus-b', 2);
    expect(fetchTests).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent loads of the same version into one fetch', async () => {
    await Promise.all([cache.ensure('a-plus-b', 1), cache.ensure('a-plus-b', 1), cache.ensure('a-plus-b', 1)]);
    expect(fetchTests).toHaveBeenCalledTimes(1);
  });

  it('refuses a problem with no tests', async () => {
    fetchTests.mockResolvedValue([]);
    await expect(cache.ensure('empty', 1)).rejects.toThrow(/no test cases/);
  });
});
