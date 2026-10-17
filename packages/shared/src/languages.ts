import type { LanguageId } from './domain.js';

export interface CompileLimits {
  cpuSec: number;
  wallSec: number;
  memoryKb: number;
  processes: number;
  fsizeKb: number;
}

export interface LanguageSpec {
  id: LanguageId;
  sourceFile: string;
  compile: readonly string[];
  /** `{memoryMb}` is replaced with the effective memory limit. */
  run: readonly string[];
  timeMultiplier: number;
  processLimit: number;
  /**
   * Floor for the run memory limit. Runtimes such as the JVM cannot start
   * inside the small limits a problem may declare, so the larger value wins.
   */
  memoryLimitKb: number;
  compileLimits: CompileLimits;
  helloWorld: string;
}

export const HELLO_WORLD_OUTPUT = 'hello world';

export const LANGUAGES: Readonly<Record<LanguageId, LanguageSpec>> = {
  cpp: {
    id: 'cpp',
    sourceFile: 'main.cpp',
    compile: ['/usr/bin/g++', '-O2', '-std=c++17', '-pipe', '-o', 'main', 'main.cpp'],
    run: ['./main'],
    timeMultiplier: 1,
    processLimit: 1,
    memoryLimitKb: 65_536,
    compileLimits: { cpuSec: 20, wallSec: 40, memoryKb: 524_288, processes: 64, fsizeKb: 65_536 },
    helloWorld: '#include <cstdio>\nint main() { std::puts("hello world"); }\n',
  },
  python: {
    id: 'python',
    sourceFile: 'main.py',
    // py_compile is only a syntax gate; the interpreter still runs main.py directly.
    compile: ['/usr/bin/python3', '-m', 'py_compile', 'main.py'],
    run: ['/usr/bin/python3', 'main.py'],
    timeMultiplier: 3,
    processLimit: 1,
    memoryLimitKb: 131_072,
    compileLimits: { cpuSec: 10, wallSec: 20, memoryKb: 262_144, processes: 8, fsizeKb: 65_536 },
    helloWorld: 'print("hello world")\n',
  },
  java: {
    id: 'java',
    sourceFile: 'Main.java',
    compile: ['/usr/bin/javac', '-encoding', 'UTF-8', '-J-Xmx384m', 'Main.java'],
    // -Xmx tracks the cgroup limit so the cgroup, not the JVM, reports memory overruns.
    run: [
      '/usr/bin/java',
      '-Xmx{memoryMb}m',
      '-Xss64m',
      '-XX:+UseSerialGC',
      '-XX:-UsePerfData',
      'Main',
    ],
    timeMultiplier: 2,
    processLimit: 64,
    memoryLimitKb: 524_288,
    compileLimits: { cpuSec: 30, wallSec: 60, memoryKb: 1_048_576, processes: 128, fsizeKb: 65_536 },
    helloWorld:
      'public class Main { public static void main(String[] a) { System.out.println("hello world"); } }\n',
  },
};

export function languageSpec(id: LanguageId): LanguageSpec {
  return LANGUAGES[id];
}
