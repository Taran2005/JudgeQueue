import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERDICTS } from '@judgequeue/shared';
import type { Verdict } from '@judgequeue/shared';
import { z } from 'zod';
import { CASES } from './cases.js';
import type { AdversarialCase } from './cases.js';

const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 120_000;
const PROGRAMS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'programs');

const resultSchema = z.object({
  status: z.string(),
  verdict: z.enum(VERDICTS).nullable(),
  time_ms: z.number().nullable(),
  memory_kb: z.number().nullable(),
});

interface CaseResult {
  testCase: AdversarialCase;
  verdict: Verdict | 'TIMEOUT';
  timeMs: number | null;
  passed: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function submit(testCase: AdversarialCase): Promise<string> {
  const code = await readFile(join(PROGRAMS_DIR, testCase.file), 'utf8');
  const response = await fetch(`${API_URL}/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ problemId: testCase.problemId, language: testCase.language, code, context: 'practice' }),
  });
  if (response.status !== 201) throw new Error(`submit failed (${response.status}): ${await response.text()}`);
  return z.object({ id: z.string() }).parse(await response.json()).id;
}

async function waitForVerdict(id: string): Promise<z.infer<typeof resultSchema> | undefined> {
  const deadline = Date.now() + TIMEOUT_MS;
  let etag: string | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(`${API_URL}/submissions/${id}`, {
      headers: etag ? { 'if-none-match': etag } : {},
    });
    if (response.status === 200) {
      etag = response.headers.get('etag') ?? undefined;
      const result = resultSchema.parse(await response.json());
      if (result.status === 'DONE') return result;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return undefined;
}

async function runCase(testCase: AdversarialCase): Promise<CaseResult> {
  const result = await waitForVerdict(await submit(testCase));
  const verdict = result?.verdict ?? 'TIMEOUT';
  return {
    testCase,
    verdict,
    timeMs: result?.time_ms ?? null,
    passed: verdict !== 'TIMEOUT' && testCase.expected.includes(verdict),
  };
}

const results = await Promise.all(CASES.map(runCase));
for (const { testCase, verdict, timeMs, passed } of results) {
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${testCase.name.padEnd(20)} expected ${testCase.expected.join('|').padEnd(4)} got ${verdict} (${timeMs ?? '-'} ms)`);
}

const failures = results.filter((result) => !result.passed);
if (failures.length > 0) {
  console.error(`${failures.length} of ${results.length} adversarial cases failed`);
  process.exit(1);
}
console.log(`all ${results.length} adversarial cases passed`);
