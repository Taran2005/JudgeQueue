import type { Pool, Verdict, SubmissionStatus, CreateSubmissionInput } from '@judgequeue/shared';

export interface SubmissionView {
  id: string;
  status: SubmissionStatus;
  verdict: Verdict | null;
  time_ms: number | null;
  memory_kb: number | null;
  failed_test: number | null;
}

export interface NewSubmission extends CreateSubmissionInput {
  id: string;
}

export interface SubmissionRepo {
  problemExists(problemId: string): Promise<boolean>;
  insert(submission: NewSubmission): Promise<void>;
  find(id: string): Promise<SubmissionView | undefined>;
  /** Returns the new judge version, or undefined when the submission does not exist. */
  resetForRejudge(id: string): Promise<number | undefined>;
}

export class PgSubmissionRepo implements SubmissionRepo {
  constructor(private readonly pool: Pool) {}

  async problemExists(problemId: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM problems WHERE id = $1', [problemId]);
    return result.rowCount === 1;
  }

  async insert(submission: NewSubmission): Promise<void> {
    await this.pool.query(
      `INSERT INTO submissions (id, problem_id, language, code, context, status)
       VALUES ($1, $2, $3, $4, $5, 'QUEUED')`,
      [submission.id, submission.problemId, submission.language, submission.code, submission.context],
    );
  }

  async find(id: string): Promise<SubmissionView | undefined> {
    const result = await this.pool.query<SubmissionView>(
      `SELECT id, status, verdict, time_ms, memory_kb, failed_test
       FROM submissions WHERE id = $1`,
      [id],
    );
    return result.rows[0];
  }

  async resetForRejudge(id: string): Promise<number | undefined> {
    const result = await this.pool.query<{ judge_version: number }>(
      `UPDATE submissions
       SET status = 'QUEUED', verdict = NULL, time_ms = NULL, memory_kb = NULL,
           failed_test = NULL, attempts = 0, context = 'rejudge',
           judge_version = judge_version + 1, updated_at = now()
       WHERE id = $1
       RETURNING judge_version`,
      [id],
    );
    return result.rows[0]?.judge_version;
  }
}
