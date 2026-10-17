# JudgeQueue

A small online judge. The API accepts submissions and queues them; a worker compiles and runs each one inside an [isolate](https://github.com/ioi/isolate) sandbox and records a verdict.

```
client ──► api ──► postgres (submissions)
             └───► redis / BullMQ ──► worker ──► isolate boxes
                                        └──► reconciler (every 30s)
```

| Path | Purpose |
| --- | --- |
| `apps/api` | Express API: create, read, rejudge, health |
| `apps/worker` | BullMQ consumer, box pool, sandbox runner, reconciler |
| `packages/shared` | Types, language registry, queue helpers, migration runner, seeder |
| `db/migrations` | SQL migrations (never edit a released one, add a new file) |
| `problems/` | Seed problems: `problem.json` plus `tests/NNN.in` / `NNN.out` |
| `scripts/adversarial` | Hostile programs run through the real system |

## Containerization

| Component | Containerized? | Why |
| --- | --- | --- |
| api, postgres, redis | Yes, `docker-compose.yml` | Stateless or standard services |
| worker | No, run it on a Linux host | isolate needs root, cgroup v2 write access and the ability to create namespaces and mounts. Doing that inside Docker means `--privileged` plus a delegated cgroup subtree, which weakens the isolation the worker exists to provide. |

Run the worker on a dedicated VM or host. It executes untrusted code, so it should hold no secrets beyond its own `DATABASE_URL` and `REDIS_URL`, and it should reach postgres and redis over a private network. Compose publishes both on `127.0.0.1` only; put the worker on the same machine or tunnel to them.

## Quick start

```bash
cp .env.example .env            # set POSTGRES_PASSWORD, and use the same value in DATABASE_URL
docker compose up -d --build    # postgres, redis, api (migrates and seeds on boot)
curl localhost:3000/health
```

Submit and poll:

```bash
curl -s localhost:3000/submissions -H 'content-type: application/json' -d '{
  "problemId": "a-plus-b", "language": "python", "context": "practice",
  "code": "a, b = map(int, input().split())\nprint(a + b)"
}'
curl -i localhost:3000/submissions/<id>
```

Seed problems: `a-plus-b`, `max-element`, `count-primes`.

## API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/submissions` | `{problemId, language, code, context}`. `context` is `contest` or `practice`. Returns `201 {id}`. Job id is the submission id; priority is contest 1, practice 2. |
| `GET` | `/submissions/:id` | `id, status, verdict, time_ms, memory_kb, failed_test`, with an `ETag`; send `If-None-Match` for a `304`. |
| `POST` | `/submissions/:id/rejudge` | Resets the row to `QUEUED`, bumps `judge_version`, enqueues with a new job id at priority 3. |
| `GET` | `/health` | `503` when postgres or redis is unreachable. |

`status` is `QUEUED`, `COMPILING`, `RUNNING` or `DONE`. `verdict` is set when `DONE`: `AC WA TLE MLE RE CE IE`. `failed_test` is the 1-based index of the first failing test.

## Worker host setup (Linux, cgroup v2)

1. Install isolate 2.x, `g++`, `python3` and a JDK (`javac`, `java`) at the paths in `packages/shared/src/languages.ts`.
2. Confirm cgroup v2: `stat -fc %T /sys/fs/cgroup` prints `cgroup2fs`.
3. Start isolate's cgroup service (`systemctl enable --now isolate.service`) so `isolate --cg` works.
4. Build and run as root:

```bash
npm ci && npm run build
DATABASE_URL=... REDIS_URL=... BOX_COUNT=4 npm run start:worker
```

On startup the worker runs `isolate --cleanup` on every box, then compiles and runs a hello-world in each language. It refuses to start if any language fails.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BOX_COUNT` | 4 | Isolate boxes; also the BullMQ concurrency |
| `BOX_ID_START` | 0 | First box id |
| `ISOLATE_BIN` | `isolate` | Path to the binary |
| `CACHE_DIR` | `.cache/tests` | Local test cache, keyed by problem id and test version |
| `OUTPUT_LIMIT_KB` | 16384 | Max bytes a program may write |
| `RECONCILE_INTERVAL_MS` | 30000 | Reconciler period |
| `STUCK_TIMEOUT_MS` | 120000 | Age after which an in-flight row counts as stuck |
| `MAX_ATTEMPTS` | 3 | Re-enqueues before a row is marked `IE` |

## How judging works

1. The worker reads the submission and skips it if `judge_version` no longer matches or it is already `DONE`.
2. It takes a box from the `BoxPool`, runs `isolate --init`, and writes the source in.
3. Compile once under the language's compile limits. A failure is `CE`.
4. For each test, only that test's input is copied into the box. The program's stdout goes to a file in the box, which the worker reads back (regular files only, so a symlink planted by the program is refused) and compares against the expected output held on the worker side.
5. The first non-passing test stops the run.
6. `finally` runs `isolate --cleanup` and releases the box.
7. The verdict is written with `UPDATE ... WHERE id = $1 AND judge_version = $2 AND status <> ALL(final states)`, so a stale job from before a rejudge cannot overwrite the new result.

Verdicts: wall or CPU timeout is `TLE`, a cgroup OOM kill is `MLE`, a non-zero exit or fatal signal is `RE` (including exceeding the output size limit), differing output is `WA`, all tests passing is `AC`, and any isolate or internal failure is `IE`. Output comparison ignores trailing whitespace on each line and trailing blank lines.

Memory limit per run is `max(problem limit, language floor)`, so the JVM can start inside a small problem limit. CPU time is the problem limit times the language multiplier.

## Reconciler

Every 30 seconds each worker looks for rows still `QUEUED`, `COMPILING` or `RUNNING` and older than `STUCK_TIMEOUT_MS`. A row whose BullMQ job is still live (waiting behind a backlog, or active) is left alone. Otherwise the row's `attempts` is incremented and a new job is enqueued with a fresh id (`<id>-v<version>-a<attempts>`), since BullMQ ignores a duplicate job id. Once `attempts` reaches 3 the row is marked `IE`. Claims are compare-and-set on `attempts`, so several workers can reconcile concurrently.

## Tests

```bash
npm test               # vitest: verdicts, BoxPool, comparer, judge pipeline, test cache, API
npm run typecheck
npm run lint
```

### Adversarial run

With the stack and a worker running:

```bash
npm run adversarial     # API_URL defaults to http://localhost:3000
```

Each program in `scripts/adversarial/programs` goes through the API and worker, and the script asserts the verdict:

| Program | Expected |
| --- | --- |
| infinite loop | `TLE` |
| `sleep(100)` | `TLE` (wall clock) |
| memory hog | `MLE` |
| fork bomb | `RE` (fork fails at the process cap) |
| output flood | `RE` (file size limit) |
| network attempt | `AC` (prints a wrong answer if it can connect, so `AC` proves the network was blocked) |
| write outside the box | `AC` (same idea for the filesystem) |
| compile error | `CE` |

The unit tests run anywhere. The worker and the adversarial run need Linux with isolate; they have not yet been run against a live isolate, so expect to tune limits (and the isolate directory bindings in `buildRunArgs`) on first contact.
