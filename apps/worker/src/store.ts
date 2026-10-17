import { FINAL_STATUSES } from '@judgequeue/shared';
import type { Pool, ProblemRow, SubmissionRow, SubmissionStatus, TestCaseRow } from '@judgequeue/shared';
import type { JudgeOutcome } from './judge.js';
import type { TestSource } from './testCache.js';

export class Store implements TestSource {
  constructor(private readonly pool: Pool) {}

  async getSubmission(id: string): Promise<SubmissionRow | undefined> {
    const result = await this.pool.query<SubmissionRow>('SELECT * FROM submissions WHERE id = $1', [id]);
    return result.rows[0];
  }

  async getProblem(id: string): Promise<ProblemRow | undefined> {
    const result = await this.pool.query<ProblemRow>(
      'SELECT id, title, time_limit_ms, memory_limit_kb, test_version FROM problems WHERE id = $1',
      [id],
    );
    return result.rows[0];
  }

  async fetchTests(problemId: string): Promise<TestCaseRow[]> {
    const result = await this.pool.query<TestCaseRow>(
      'SELECT ordinal, input, expected_output FROM test_cases WHERE problem_id = $1 ORDER BY ordinal',
      [problemId],
    );
    return result.rows;
  }

  /** False means the row was rejudged or already finished, so this job is stale. */
  async advanceStatus(id: string, judgeVersion: number, status: SubmissionStatus): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE submissions SET status = $3, updated_at = now()
       WHERE id = $1 AND judge_version = $2 AND status <> ALL($4::text[])`,
      [id, judgeVersion, status, FINAL_STATUSES],
    );
    return result.rowCount === 1;
  }

  async writeVerdict(id: string, judgeVersion: number, outcome: JudgeOutcome): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE submissions
       SET status = 'DONE', verdict = $3, time_ms = $4, memory_kb = $5, failed_test = $6, updated_at = now()
       WHERE id = $1 AND judge_version = $2 AND status <> ALL($7::text[])`,
      [id, judgeVersion, outcome.verdict, outcome.timeMs, outcome.memoryKb, outcome.failedTest, FINAL_STATUSES],
    );
    return result.rowCount === 1;
  }
}
