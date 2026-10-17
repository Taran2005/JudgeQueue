import { tmpdir } from 'node:os';
import { baseEnvSchema, parseEnv } from '@judgequeue/shared';
import { z } from 'zod';

const workerEnvSchema = baseEnvSchema.extend({
  ISOLATE_BIN: z.string().default('isolate'),
  BOX_COUNT: z.coerce.number().int().min(1).max(100).default(4),
  BOX_ID_START: z.coerce.number().int().min(0).default(0),
  CACHE_DIR: z.string().default('.cache/tests'),
  META_DIR: z.string().default(tmpdir()),
  OUTPUT_LIMIT_KB: z.coerce.number().int().positive().default(65_536),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  STUCK_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
});

export type WorkerConfig = z.infer<typeof workerEnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return parseEnv(workerEnvSchema, env);
}
