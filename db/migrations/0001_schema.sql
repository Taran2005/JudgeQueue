CREATE TABLE problems (
  id              text PRIMARY KEY,
  title           text NOT NULL,
  time_limit_ms   integer NOT NULL CHECK (time_limit_ms > 0),
  memory_limit_kb integer NOT NULL CHECK (memory_limit_kb > 0),
  test_version    integer NOT NULL DEFAULT 1,
  tests_hash      text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE test_cases (
  problem_id      text NOT NULL REFERENCES problems (id) ON DELETE CASCADE,
  ordinal         integer NOT NULL CHECK (ordinal > 0),
  input           text NOT NULL,
  expected_output text NOT NULL,
  PRIMARY KEY (problem_id, ordinal)
);

CREATE TABLE submissions (
  id            uuid PRIMARY KEY,
  problem_id    text NOT NULL REFERENCES problems (id),
  language      text NOT NULL,
  code          text NOT NULL,
  context       text NOT NULL CHECK (context IN ('contest', 'practice', 'rejudge')),
  status        text NOT NULL DEFAULT 'QUEUED'
                CHECK (status IN ('QUEUED', 'COMPILING', 'RUNNING', 'DONE')),
  verdict       text CHECK (verdict IN ('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'IE')),
  time_ms       integer,
  memory_kb     integer,
  failed_test   integer,
  attempts      integer NOT NULL DEFAULT 0,
  judge_version integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'DONE') = (verdict IS NOT NULL))
);
