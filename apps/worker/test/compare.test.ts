import { describe, expect, it } from 'vitest';
import { outputsMatch } from '../src/compare.js';

describe('outputsMatch', () => {
  it.each([
    ['identical', '42\n', '42\n'],
    ['missing final newline', '42', '42\n'],
    ['extra trailing newlines', '42\n\n\n', '42\n'],
    ['trailing spaces on a line', '1 2 3   \n4\n', '1 2 3\n4\n'],
    ['windows line endings', '1\r\n2\r\n', '1\n2\n'],
    ['trailing tabs', '7\t\t\n', '7\n'],
    ['both empty', '', '\n'],
  ])('accepts %s', (_name, actual, expected) => {
    expect(outputsMatch(actual, expected)).toBe(true);
  });

  it.each([
    ['different value', '41\n', '42\n'],
    ['leading whitespace', ' 42\n', '42\n'],
    ['inner spacing', '1  2\n', '1 2\n'],
    ['missing line', '1\n', '1\n2\n'],
    ['blank line in the middle', '1\n\n2\n', '1\n2\n'],
    ['case difference', 'Yes\n', 'yes\n'],
    ['empty output', '', '0\n'],
  ])('rejects %s', (_name, actual, expected) => {
    expect(outputsMatch(actual, expected)).toBe(false);
  });
});
