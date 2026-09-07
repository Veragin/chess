import { describe, expect, it } from 'vitest';
import type { ImportResult } from '../../../storage/lines';
import type { SeedReport } from '../../../storage/seed';
import type { ResetSummary } from '../../../storage/reset';
import { describeImport, describeReset, describeSeed } from './importReport';

function result(partial: Partial<ImportResult>): ImportResult {
  return { added: 0, skipped: 0, rejections: [], ...partial };
}

function summary(partial: Partial<ResetSummary> = {}): ResetSummary {
  return { total: 0, custom: 0, blindGame: false, ...partial };
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

describe('describeSeed', () => {
  function seed(partial: Partial<SeedReport>): SeedReport {
    return { added: 0, files: [], ...partial };
  }

  it('says nothing before the seeder has run', () => {
    expect(describeSeed(null)).toBeNull();
  });

  it('says nothing when every bundled line was readable', () => {
    const view = describeSeed(
      seed({ added: 27, files: [{ file: 'stafford.json', added: 27, skipped: 0, rejections: [] }] }),
    );
    // The lines are in the list; announcing them would be noise on every first visit.
    expect(view).toBeNull();
  });

  it('names the file for a line it could not read', () => {
    const view = describeSeed(
      seed({
        added: 2,
        files: [
          {
            file: 'stafford.json',
            added: 2,
            skipped: 1,
            rejections: [{ name: 'Broken', reason: 'illegal move "Qxh8" at ply 2' }],
          },
        ],
      }),
    );
    expect(view?.tone).toBe('warn');
    expect(view?.headline).toContain('Added 2');
    expect(view?.details).toEqual(['stafford.json — Broken — illegal move "Qxh8" at ply 2']);
  });

  it('reports a file-level failure as an error when nothing was added', () => {
    const view = describeSeed(
      seed({
        files: [{ file: 'junk.json', added: 0, skipped: 0, rejections: [], error: 'Not valid JSON' }],
      }),
    );
    expect(view?.tone).toBe('error');
    expect(view?.headline).toMatch(/left untouched/i);
    expect(view?.details).toEqual(['junk.json — Not valid JSON']);
  });

  it('leads with a write failure that affected the whole seed', () => {
    const view = describeSeed(
      seed({
        added: 1,
        error: 'storage full',
        files: [{ file: 'a.json', added: 1, skipped: 0, rejections: [] }],
      }),
    );
    expect(view?.details).toEqual(['storage full']);
  });
});

describe('describeReset', () => {
  it('says nothing of the user’s own was lost when every line was bundled', () => {
    const view = describeReset(summary({ total: 12 }), { ok: true });
    expect(view.tone).toBe('ok');
    expect(view.headline).toContain('12');
    expect(view.headline).toMatch(/nothing of your own/i);
    expect(view.details).toEqual([
      'The bundled lines are added again the next time the app loads.',
    ]);
  });

  it('warns, and repeats the custom count, when the user lost their own lines', () => {
    const view = describeReset(summary({ total: 12, custom: 5 }), { ok: true });
    expect(view.tone).toBe('warn');
    expect(view.headline).toContain('12');
    expect(view.headline).toContain('5');
    expect(view.headline).toMatch(/cannot be undone/i);
  });

  it('mentions the blind game only when there was one', () => {
    expect(describeReset(summary({ blindGame: true }), { ok: true }).details).toContain(
      'The saved blind game was deleted.',
    );
    expect(describeReset(summary(), { ok: true }).details).not.toContain(
      'The saved blind game was deleted.',
    );
  });

  it('leads with the reason when the store could not be fully cleared', () => {
    const view = describeReset(summary({ total: 3, custom: 3 }), {
      ok: false,
      error: 'Browser storage is unavailable',
    });
    expect(view.tone).toBe('error');
    expect(view.headline).toMatch(/could not be fully cleared/i);
    expect(view.details[0]).toBe('Browser storage is unavailable');
  });
});
