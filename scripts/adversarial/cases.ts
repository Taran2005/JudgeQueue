import type { LanguageId, Verdict } from '@judgequeue/shared';

export interface AdversarialCase {
  name: string;
  file: string;
  language: LanguageId;
  problemId: string;
  expected: readonly Verdict[];
}

// The network and write cases print a wrong answer when the sandbox leaks,
// so AC is the passing result: it proves the escape attempt failed.
export const CASES: readonly AdversarialCase[] = [
  { name: 'infinite loop', file: 'infinite_loop.cpp', language: 'cpp', problemId: 'a-plus-b', expected: ['TLE'] },
  { name: 'sleep(100)', file: 'sleep_100.cpp', language: 'cpp', problemId: 'a-plus-b', expected: ['TLE'] },
  { name: 'memory hog', file: 'memory_hog.cpp', language: 'cpp', problemId: 'a-plus-b', expected: ['MLE'] },
  { name: 'fork bomb', file: 'fork_bomb.cpp', language: 'cpp', problemId: 'a-plus-b', expected: ['RE'] },
  { name: 'output flood', file: 'output_flood.cpp', language: 'cpp', problemId: 'a-plus-b', expected: ['RE'] },
  { name: 'network attempt', file: 'network_attempt.cpp', language: 'cpp', problemId: 'a-plus-b', expected: ['AC'] },
  { name: 'write outside box', file: 'write_outside_box.cpp', language: 'cpp', problemId: 'a-plus-b', expected: ['AC'] },
  { name: 'compile error', file: 'compile_error.cpp', language: 'cpp', problemId: 'a-plus-b', expected: ['CE'] },
];
