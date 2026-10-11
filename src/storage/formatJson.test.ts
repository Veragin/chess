import { describe, expect, it } from 'vitest';
import { formatJson } from './formatJson';

describe('formatJson', () => {
  it('is JSON that parses back to the same value', () => {
    const value = {
      a: 1,
      skip: undefined,
      text: 'with "quotes"\nand a newline',
      list: Array.from({ length: 60 }, (_, i) => (i % 7 === 0 ? [`v${i}`, `w${i}`] : `m${i}`)),
      nested: { empty: [], none: null, flag: true },
    };
    const text = formatJson(value);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(value)));
  });

  it('keeps what fits on one line, and fills long arrays into rows within the width', () => {
    expect(formatJson({ tree: ['e4', 'e5', ['c5']] })).toBe('{"tree": ["e4", "e5", ["c5"]]}\n');
    const moves = Array.from({ length: 40 }, (_, i) => `Nf${i}`);
    const lines = formatJson({ tree: moves }).split('\n');
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.length).toBeLessThan(moves.length);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(100);
  });

  it('puts an item too long for a row on rows of its own, indented', () => {
    const long = Array.from({ length: 30 }, (_, i) => `x${i}`);
    const text = formatJson(['e4', long, 'd4']);
    expect(text).toMatch(/^\[\n {2}"e4",\n {2}\[\n {4}"x0", "x1"/);
    expect(text).toMatch(/\n {2}\],\n {2}"d4"\n\]\n$/);
  });
});
