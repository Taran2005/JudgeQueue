import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Pool, PoolClient } from './db.js';
import type { Logger } from './logger.js';

const problemMetaSchema = z.object({
  title: z.string().min(1),
  timeLimitMs: z.number().int().positive(),
  memoryLimitKb: z.number().int().positive(),
});

interface FixtureTest {
  ordinal: number;
  input: string;
  expected: string;
}

interface ProblemFixture {
  id: string;
  meta: z.infer<typeof problemMetaSchema>;
  tests: FixtureTest[];
}

async function loadTests(testsDir: string): Promise<FixtureTest[]> {
  const inputs = (await readdir(testsDir)).filter((file) => /^\d+\.in$/.test(file));
  const tests = await Promise.all(
    inputs.map(async (file) => {
      const stem = file.slice(0, -'.in'.length);
      return {
        ordinal: Number.parseInt(stem, 10),
        input: await readFile(join(testsDir, file), 'utf8'),
        expected: await readFile(join(testsDir, `${stem}.out`), 'utf8'),
      };
    }),
  );
  return tests.sort((a, b) => a.ordinal - b.ordinal);
}

export async function loadProblemFixtures(dir: string): Promise<ProblemFixture[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const fixtures: ProblemFixture[] = [];
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const root = join(dir, entry.name);
    const meta = problemMetaSchema.parse(JSON.parse(await readFile(join(root, 'problem.json'), 'utf8')));
    fixtures.push({ id: entry.name, meta, tests: await loadTests(join(root, 'tests')) });
  }
  return fixtures;
}

function hashTests(tests: readonly FixtureTest[]): string {
  const hash = createHash('sha256');
  for (const test of tests) hash.update(`${test.ordinal}\0${test.input}\0${test.expected}\0`);
  return hash.digest('hex');
}

async function upsertProblem(client: PoolClient, fixture: ProblemFixture, hash: string): Promise<boolean> {
  const existing = await client.query<{ tests_hash: string }>(
    'SELECT tests_hash FROM problems WHERE id = $1 FOR UPDATE',
    [fixture.id],
  );
  const changed = existing.rows[0]?.tests_hash !== hash;
  await client.query(
    `INSERT INTO problems (id, title, time_limit_ms, memory_limit_kb, tests_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       time_limit_ms = EXCLUDED.time_limit_ms,
       memory_limit_kb = EXCLUDED.memory_limit_kb,
       tests_hash = EXCLUDED.tests_hash,
       test_version = problems.test_version + CASE WHEN problems.tests_hash = EXCLUDED.tests_hash THEN 0 ELSE 1 END`,
    [fixture.id, fixture.meta.title, fixture.meta.timeLimitMs, fixture.meta.memoryLimitKb, hash],
  );
  return changed;
}

async function replaceTests(client: PoolClient, fixture: ProblemFixture): Promise<void> {
  await client.query('DELETE FROM test_cases WHERE problem_id = $1', [fixture.id]);
  for (const test of fixture.tests) {
    await client.query(
      'INSERT INTO test_cases (problem_id, ordinal, input, expected_output) VALUES ($1, $2, $3, $4)',
      [fixture.id, test.ordinal, test.input, test.expected],
    );
  }
}

async function seedProblem(pool: Pool, fixture: ProblemFixture, log: Logger): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const changed = await upsertProblem(client, fixture, hashTests(fixture.tests));
    if (changed) await replaceTests(client, fixture);
    await client.query('COMMIT');
    log.info({ problem: fixture.id, tests: fixture.tests.length, changed }, 'problem seeded');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function seedProblems(pool: Pool, dir: string, log: Logger): Promise<void> {
  for (const fixture of await loadProblemFixtures(dir)) {
    await seedProblem(pool, fixture, log);
  }
}
