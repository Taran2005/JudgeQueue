export type IsolateStatus = 'RE' | 'SG' | 'TO' | 'XX';

export interface IsolateMeta {
  status?: IsolateStatus;
  exitCode?: number;
  exitSignal?: number;
  oomKilled: boolean;
  timeMs: number;
  wallMs: number;
  memoryKb: number;
  message?: string;
}

const STATUSES: readonly string[] = ['RE', 'SG', 'TO', 'XX'];

function parseFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const separator = line.indexOf(':');
    if (separator > 0) fields.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  return fields;
}

function numberField(fields: Map<string, string>, key: string): number | undefined {
  const raw = fields.get(key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function parseMeta(text: string): IsolateMeta {
  const fields = parseFields(text);
  const rawStatus = fields.get('status');
  const status = rawStatus === undefined ? undefined : STATUSES.includes(rawStatus) ? (rawStatus as IsolateStatus) : 'XX';
  const toMs = (seconds: number | undefined): number => Math.round((seconds ?? 0) * 1000);

  return {
    status,
    exitCode: numberField(fields, 'exitcode'),
    exitSignal: numberField(fields, 'exitsig'),
    oomKilled: fields.get('cg-oom-killed') === '1',
    timeMs: toMs(numberField(fields, 'time')),
    wallMs: toMs(numberField(fields, 'time-wall')),
    memoryKb: Math.max(numberField(fields, 'max-rss') ?? 0, numberField(fields, 'cg-mem') ?? 0),
    message: fields.get('message'),
  };
}
