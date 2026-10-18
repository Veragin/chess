import { describe, expect, it } from 'vitest';
import type { ImportResult } from '../../../storage/lines';
import type { SeedReport } from '../../../storage/seed';
import type { RefreshResult, ResetSummary } from '../../../storage/reset';
import { combineReports, describeImport, describeRefresh, describeSeed } from './importReport';

function result(partial: Partial<ImportResult>): ImportResult {
  return { added: 0, skipped: 0, rejections: [], ...partial };
}

function summary(partial: Partial<ResetSummary> = {}): ResetSummary {
  return { total: 0, custom: 0, hidden: 0, personal: 0, ...partial };
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
    expect(view?.headline).toContain('Loaded 2');
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
});

describe('describeRefresh', () => {
  const KEEP = { mode: 'keep-user-lines', clearPersonal: false } as const;
  const DELETE = { mode: 'delete-user-lines', clearPersonal: false } as const;

  function refreshed(partial: Partial<RefreshResult> = {}): RefreshResult {
    return { ok: true, personalRemoved: 0, personalCleared: false, ...partial };
  }

  it('reports kept lines and pruned personal lines in one sentence', () => {
    const view = describeRefresh(
      summary({ total: 40, custom: 12 }),
      KEEP,
      refreshed({ personalRemoved: 3 }),
    );
    expect(view.tone).toBe('ok');
    expect(view.headline).toBe(
      'Bundled lines refreshed. 12 of your lines kept. 3 personal lines no longer exist and were removed.',
    );
  });

  it('uses the singular for one pruned personal line', () => {
    const view = describeRefresh(summary(), KEEP, refreshed({ personalRemoved: 1 }));
    expect(view.headline).toBe(
      'Bundled lines refreshed. 1 personal line no longer exists and was removed.',
    );
  });

  it('says only that the bundled lines were refreshed when nothing else changed', () => {
    const view = describeRefresh(summary({ total: 12 }), KEEP, refreshed());
    expect(view.tone).toBe('ok');
    expect(view.headline).toBe('Bundled lines refreshed.');
    expect(view.details).toEqual([]);
  });

  it('warns, and repeats the count, when the user deleted their own lines', () => {
    const view = describeRefresh(summary({ custom: 5 }), DELETE, refreshed());
    expect(view.tone).toBe('warn');
    expect(view.headline).toContain('Deleted 5 lines of your own');
    expect(view.headline).toMatch(/cannot be undone/i);
  });

  it('warns when the Personal list was cleared', () => {
    const view = describeRefresh(
      summary({ personal: 7 }),
      { mode: 'keep-user-lines', clearPersonal: true },
      refreshed({ personalCleared: true }),
    );
    expect(view.tone).toBe('warn');
    expect(view.headline).toContain('Your Personal list (7 lines) was cleared.');
  });

  it('mentions restored bundled lines, and kept edited copies in keep mode', () => {
    const keep = describeRefresh(summary({ custom: 2, hidden: 3 }), KEEP, refreshed());
    expect(keep.details).toEqual([
      '3 bundled lines you had deleted or edited are back.',
      'Edited copies of bundled lines are kept alongside the originals.',
    ]);
    const del = describeRefresh(summary({ custom: 2, hidden: 1 }), DELETE, refreshed());
    expect(del.details).toEqual(['1 bundled line you had deleted or edited is back.']);
  });

  it('leads with the reason when storage could not be fully updated', () => {
    const view = describeRefresh(
      summary({ custom: 3 }),
      DELETE,
      refreshed({ ok: false, error: 'Browser storage is unavailable' }),
    );
    expect(view.tone).toBe('error');
    expect(view.headline).toMatch(/could not be fully updated/i);
    expect(view.details[0]).toBe('Browser storage is unavailable');
  });
});

describe('combineReports', () => {
  const ok = { tone: 'ok' as const, headline: 'Bundled lines refreshed.', details: ['a'] };

  it('returns the first report alone when there is no second', () => {
    expect(combineReports(ok, null)).toBe(ok);
  });

  it('appends the second headline and details, keeping the worse tone', () => {
    const seed = { tone: 'error' as const, headline: 'Seed failed.', details: ['x.json — bad'] };
    expect(combineReports(ok, seed)).toEqual({
      tone: 'error',
      headline: 'Bundled lines refreshed.',
      details: ['a', 'Seed failed.', 'x.json — bad'],
    });
    const warn = { tone: 'warn' as const, headline: 'W', details: [] };
    expect(combineReports(warn, { ...ok, details: [] }).tone).toBe('warn');
  });
});
