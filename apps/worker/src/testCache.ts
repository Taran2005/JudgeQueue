import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger, TestCaseRow } from '@judgequeue/shared';

export interface CachedTest {
  ordinal: number;
  inputPath: string;
  expectedPath: string;
}

export interface TestSource {
  fetchTests(problemId: string): Promise<TestCaseRow[]>;
}

const MANIFEST = 'manifest.json';

function fileName(ordinal: number, extension: 'in' | 'out'): string {
  return `${String(ordinal).padStart(3, '0')}.${extension}`;
}

function toCachedTests(dir: string, ordinals: readonly number[]): CachedTest[] {
  return ordinals.map((ordinal) => ({
    ordinal,
    inputPath: join(dir, fileName(ordinal, 'in')),
    expectedPath: join(dir, fileName(ordinal, 'out')),
  }));
}

export class TestCache {
  private readonly inflight = new Map<string, Promise<CachedTest[]>>();

  constructor(
    private readonly root: string,
    private readonly source: TestSource,
    private readonly log: Logger,
  ) {}

  ensure(problemId: string, testVersion: number): Promise<CachedTest[]> {
    const key = `${problemId}@${testVersion}`;
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.load(problemId, testVersion).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  private async load(problemId: string, testVersion: number): Promise<CachedTest[]> {
    const versionDir = join(this.root, problemId, `v${testVersion}`);
    const cached = await this.readManifest(versionDir);
    if (cached) return toCachedTests(versionDir, cached);

    const tests = await this.source.fetchTests(problemId);
    if (tests.length === 0) throw new Error(`problem ${problemId} has no test cases`);
    await this.publish(join(this.root, problemId), versionDir, tests);
    this.log.info({ problemId, testVersion, tests: tests.length }, 'test cache populated');
    return toCachedTests(versionDir, tests.map((test) => test.ordinal));
  }

  private async readManifest(versionDir: string): Promise<number[] | undefined> {
    try {
      return JSON.parse(await readFile(join(versionDir, MANIFEST), 'utf8')) as number[];
    } catch {
      return undefined;
    }
  }

  /** Written to a temp dir and renamed so a reader never sees a half-populated version. */
  private async publish(problemDir: string, versionDir: string, tests: readonly TestCaseRow[]): Promise<void> {
    await mkdir(problemDir, { recursive: true });
    const staging = await mkdtemp(join(problemDir, '.staging-'));
    try {
      await Promise.all(
        tests.flatMap((test) => [
          writeFile(join(staging, fileName(test.ordinal, 'in')), test.input),
          writeFile(join(staging, fileName(test.ordinal, 'out')), test.expected_output),
        ]),
      );
      await writeFile(join(staging, MANIFEST), JSON.stringify(tests.map((test) => test.ordinal)));
      await rename(staging, versionDir);
    } catch (err) {
      await rm(staging, { recursive: true, force: true });
      // Another worker process published the same version first.
      if (!(await this.readManifest(versionDir))) throw err;
    }
  }
}
