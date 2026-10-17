import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseMeta } from './meta.js';
import type { IsolateMeta } from './meta.js';

const execFileAsync = promisify(execFile);

export interface RunLimits {
  cpuSec: number;
  wallSec: number;
  memoryKb: number;
  processes: number;
  fsizeKb: number;
}

export interface RunSpec {
  command: readonly string[];
  limits: RunLimits;
  stdin?: string;
  stdout: string;
  stderr: string;
}

export interface JudgeSandbox {
  writeFile(name: string, data: string | Buffer): Promise<void>;
  removeFile(name: string): Promise<void>;
  readOutput(name: string, maxBytes: number): Promise<string>;
  run(spec: RunSpec): Promise<IsolateMeta>;
}

export class IsolateError extends Error {}
export class SandboxFileError extends Error {}

const SANDBOX_PATH = '/usr/local/bin:/usr/bin:/bin';
const EXTRA_TIME_SEC = 0.3;
const ISOLATE_INTERNAL_ERROR = 2;

function seconds(value: number): string {
  return value.toFixed(3);
}

export function buildRunArgs(boxId: number, metaPath: string, spec: RunSpec): string[] {
  const { limits } = spec;
  return [
    `--box-id=${boxId}`,
    '--cg',
    `--meta=${metaPath}`,
    `--time=${seconds(limits.cpuSec)}`,
    `--wall-time=${seconds(limits.wallSec)}`,
    `--extra-time=${seconds(EXTRA_TIME_SEC)}`,
    `--cg-mem=${limits.memoryKb}`,
    `--processes=${limits.processes}`,
    `--fsize=${limits.fsizeKb}`,
    '--open-files=256',
    '--dir=/etc/alternatives:maybe',
    `--env=PATH=${SANDBOX_PATH}`,
    '--env=HOME=/box',
    ...(spec.stdin ? [`--stdin=${spec.stdin}`] : []),
    `--stdout=${spec.stdout}`,
    `--stderr=${spec.stderr}`,
    '--run',
    '--',
    ...spec.command,
  ];
}

interface ExecFailure {
  code?: number | string;
  stderr?: string;
}

async function execIsolate(bin: string, args: string[], timeoutMs?: number): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await execFileAsync(bin, args, { maxBuffer: 1 << 20, timeout: timeoutMs });
    return { stdout, code: 0 };
  } catch (err) {
    const failure = err as ExecFailure & { stdout?: string };
    if (typeof failure.code === 'number') return { stdout: failure.stdout ?? '', code: failure.code };
    throw new IsolateError(`failed to execute ${bin}: ${(err as Error).message}`);
  }
}

export class Sandbox implements JudgeSandbox {
  private boxDir: string | undefined;

  constructor(
    private readonly bin: string,
    readonly boxId: number,
    private readonly metaDir: string,
  ) {}

  private get dir(): string {
    if (!this.boxDir) throw new IsolateError(`box ${this.boxId} is not initialised`);
    return this.boxDir;
  }

  private async attempt(...flags: string[]): Promise<string> {
    const { stdout, code } = await execIsolate(this.bin, [`--box-id=${this.boxId}`, '--cg', ...flags]);
    if (code !== 0) throw new IsolateError(`isolate ${flags.join(' ')} exited with ${code} on box ${this.boxId}`);
    return stdout.trim();
  }

  async init(): Promise<void> {
    let root: string;
    try {
      root = await this.attempt('--init');
    } catch {
      await this.cleanup();
      root = await this.attempt('--init');
    }
    this.boxDir = join(root, 'box');
  }

  async cleanup(): Promise<void> {
    await this.attempt('--cleanup');
    this.boxDir = undefined;
  }

  async writeFile(name: string, data: string | Buffer): Promise<void> {
    await writeFile(join(this.dir, name), data, { mode: 0o644 });
  }

  async removeFile(name: string): Promise<void> {
    await rm(join(this.dir, name), { force: true });
  }

  /**
   * The sandboxed program owns the box directory and can replace its output file
   * with a symlink to a host path, so only regular files are ever opened here.
   */
  async readOutput(name: string, maxBytes: number): Promise<string> {
    const path = join(this.dir, name);
    const info = await lstat(path).catch(() => undefined);
    if (!info?.isFile()) throw new SandboxFileError(`${name} is not a regular file`);
    if (info.size > maxBytes) throw new SandboxFileError(`${name} exceeds ${maxBytes} bytes`);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  }

  async run(spec: RunSpec): Promise<IsolateMeta> {
    const metaPath = join(this.metaDir, `box-${this.boxId}.meta`);
    await rm(metaPath, { force: true });
    const timeoutMs = (spec.limits.wallSec + 15) * 1000;
    const { code } = await execIsolate(this.bin, buildRunArgs(this.boxId, metaPath, spec), timeoutMs);
    if (code >= ISOLATE_INTERNAL_ERROR) throw new IsolateError(`isolate --run exited with ${code}`);
    try {
      return parseMeta(await readFile(metaPath, 'utf8'));
    } catch (err) {
      throw new IsolateError(`missing meta file for box ${this.boxId}: ${(err as Error).message}`);
    } finally {
      await rm(metaPath, { force: true });
    }
  }
}
