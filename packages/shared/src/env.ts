import { z } from 'zod';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

export const booleanFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const baseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export function parseEnv<S extends z.ZodTypeAny>(
  schema: S,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const fields = JSON.stringify(result.error.flatten().fieldErrors);
    throw new Error(`Invalid configuration: ${fields}`);
  }
  return result.data;
}
