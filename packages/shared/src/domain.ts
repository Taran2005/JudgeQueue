import { z } from 'zod';

export const LANGUAGE_IDS = ['cpp', 'python', 'java'] as const;
export type LanguageId = (typeof LANGUAGE_IDS)[number];

export const CONTEXTS = ['contest', 'practice', 'rejudge'] as const;
export type SubmissionContext = (typeof CONTEXTS)[number];

export const CONTEXT_PRIORITY: Record<SubmissionContext, number> = {
  contest: 1,
  practice: 2,
  rejudge: 3,
};

export const STATUSES = ['QUEUED', 'COMPILING', 'RUNNING', 'DONE'] as const;
export type SubmissionStatus = (typeof STATUSES)[number];

export const FINAL_STATUSES: readonly SubmissionStatus[] = ['DONE'];
export const IN_FLIGHT_STATUSES: readonly SubmissionStatus[] = ['QUEUED', 'COMPILING', 'RUNNING'];

export const VERDICTS = ['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'IE'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const MAX_SOURCE_BYTES = 64 * 1024;

export const createSubmissionSchema = z.object({
  problemId: z.string().min(1).max(64),
  language: z.enum(LANGUAGE_IDS),
  code: z
    .string()
    .min(1)
    .refine((code) => Buffer.byteLength(code, 'utf8') <= MAX_SOURCE_BYTES, {
      message: `code exceeds ${MAX_SOURCE_BYTES} bytes`,
    }),
  context: z.enum(['contest', 'practice']),
});
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

export interface SubmissionRow {
  id: string;
  problem_id: string;
  language: LanguageId;
  code: string;
  context: SubmissionContext;
  status: SubmissionStatus;
  verdict: Verdict | null;
  time_ms: number | null;
  memory_kb: number | null;
  failed_test: number | null;
  attempts: number;
  judge_version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ProblemRow {
  id: string;
  title: string;
  time_limit_ms: number;
  memory_limit_kb: number;
  test_version: number;
}

export interface TestCaseRow {
  ordinal: number;
  input: string;
  expected_output: string;
}

export function isFinalStatus(status: SubmissionStatus): boolean {
  return FINAL_STATUSES.includes(status);
}
