import { describe, expect, it } from 'vitest';
import type { ImportResult } from '../../../storage/lines';
import { describeImport } from './importReport';

function result(partial: Partial<ImportResult>): ImportResult {
  return { added: 0, skipped: 0, rejections: [], ...partial };
}

describe('describeImport', () => {
  it('reports a clean import', () => {
    const view = describeImport(result({ added: 3 }));
    expect(view.tone).toBe('ok');
    expect(view.headline).toContain('Imported 3');
    expect(view.headline).toContain('skipped 0');
    expect(view.details).toEqual([]);
  });

  it('warns and lists reasons for a partial import', () => {
    const view = describeImport(
      result({
        added: 1,
        skipped: 2,
        rejections: [
          { name: 'Bad FEN', reason: 'illegal start position: no white king' },
          { name: '(unnamed line #4)', reason: 'illegal move "Qh5" at ply 2' },
        ],
      }),
    );
    expect(view.tone).toBe('warn');
    expect(view.headline).toContain('Imported 1');
    expect(view.details).toEqual([
      'Bad FEN — illegal start position: no white king',
      '(unnamed line #4) — illegal move "Qh5" at ply 2',
    ]);
  });

  it('treats a file-level error with nothing added as a failure that changed nothing', () => {
    const view = describeImport(result({ error: 'Missing or invalid "schemaVersion"' }));
    expect(view.tone).toBe('error');
    expect(view.headline).toMatch(/left untouched/i);
    expect(view.details[0]).toBe('Missing or invalid "schemaVersion"');
  });

  it('treats every-line-rejected as an error, still listing the reasons', () => {
    const view = describeImport(
      result({ skipped: 1, rejections: [{ name: 'Only line', reason: 'not an object' }] }),
    );
    expect(view.tone).toBe('error');
    expect(view.headline).toMatch(/nothing imported/i);
    expect(view.headline).toMatch(/left untouched/i);
    expect(view.details).toEqual(['Only line — not an object']);
  });

  it('says so when the file simply had no lines', () => {
    const view = describeImport(result({}));
    expect(view.tone).toBe('warn');
    expect(view.headline).toMatch(/no lines/i);
  });

  it('surfaces a write failure alongside a successful validation', () => {
    const view = describeImport(result({ added: 2, error: 'storage full' }));
    expect(view.tone).toBe('warn');
    expect(view.headline).toContain('Imported 2');
    expect(view.details).toContain('storage full');
  });
});
