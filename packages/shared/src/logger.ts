import { pino } from 'pino';
import type { Logger } from 'pino';

export type { Logger };

export function createLogger(name: string, level = 'info'): Logger {
  return pino({ name, level });
}
