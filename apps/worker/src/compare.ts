function normalize(text: string): string {
  return text.replace(/[ \t\r]+$/gm, '').replace(/\s+$/, '');
}

export function outputsMatch(actual: string, expected: string): boolean {
  return normalize(actual) === normalize(expected);
}
