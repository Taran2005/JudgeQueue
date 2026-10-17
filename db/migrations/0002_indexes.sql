CREATE INDEX submissions_in_flight_idx
  ON submissions (updated_at)
  WHERE status IN ('QUEUED', 'COMPILING', 'RUNNING');

CREATE INDEX submissions_problem_created_idx
  ON submissions (problem_id, created_at DESC);
