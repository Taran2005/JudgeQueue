import { baseEnvSchema, booleanFlag, parseEnv } from '@judgequeue/shared';
import { z } from 'zod';

const apiEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  AUTO_MIGRATE: booleanFlag,
  AUTO_SEED: booleanFlag,
  MIGRATIONS_DIR: z.string().default('db/migrations'),
  PROBLEMS_DIR: z.string().default('problems'),
});

export type ApiConfig = z.infer<typeof apiEnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return parseEnv(apiEnvSchema, env);
}
