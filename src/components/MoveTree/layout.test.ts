import { describe, expect, it } from 'vitest';
import type { MoveTree } from '../../chess/tree';
import { treeFromMoves } from '../../chess/tree';
import { buildBlocks, type Block } from './layout';

/** PGN-like text of the layout: runs joined by spaces, variations in parentheses. */
function text(blocks: Block[]): string {
  return blocks
    .map((block) =>
      block.kind === 'run'
        ? block.moves.map((m) => `${m.number}${m.san}${m.comment !== undefined ? '*' : ''}`).join(' ')
        : `( ${text(block.body)} )`,
    )
    .join(' ');
}

const white = { start: 'w' as const, startNumber: 1 };

describe('buildBlocks', () => {
  it('lays a linear line out as one run', () => {
    const blocks = buildBlocks(treeFromMoves(['e4', 'e5', 'Nf3']), white);
    expect(blocks).toHaveLength(1);
    expect(text(blocks)).toBe('1.e4 e5 2.Nf3');
  });

  it('is empty for an empty tree', () => {
    expect(buildBlocks([], white)).toEqual([]);
  });

  it('puts alternatives right after the main move and renumbers where the main line resumes', () => {
    const tree: MoveTree = [
      {
        san: 'e4',
        next: [
          { san: 'e5', next: [{ san: 'Nf3', next: [{ san: 'Nc6', next: [] }] }] },
          { san: 'c5', comment: 'Sicilian', next: [{ san: 'Nf3', next: [] }] },
          { san: 'c6', next: [] },
        ],
      },
      { san: 'd4', next: [] },
    ];
    expect(text(buildBlocks(tree, white))).toBe(
      '1.e4 ( 1.d4 ) 1…e5 ( 1…c5* 2.Nf3 ) ( 1…c6 ) 2.Nf3 Nc6',
    );
  });

  it('nests variations inside variations', () => {
    const tree: MoveTree = [
      {
        san: 'e4',
        next: [
          { san: 'e5', next: [] },
          {
            san: 'c5',
            next: [
              { san: 'Nf3', next: [] },
              { san: 'c3', next: [{ san: 'd5', next: [] }] },
            ],
          },
        ],
      },
    ];
    const blocks = buildBlocks(tree, white);
    expect(text(blocks)).toBe('1.e4 e5 ( 1…c5 2.Nf3 ( 2.c3 d5 ) )');
    const variation = blocks[1];
    expect(variation?.kind).toBe('variation');
    if (variation?.kind === 'variation') {
      expect(variation.body[1]?.kind).toBe('variation');
    }
  });

  it('carries each move’s path for selection', () => {
    const tree: MoveTree = [{ san: 'e4', next: [{ san: 'e5', next: [] }, { san: 'c5', next: [] }] }];
    const blocks = buildBlocks(tree, white);
    const variation = blocks[1];
    if (variation?.kind !== 'variation' || variation.body[0]?.kind !== 'run') {
      throw new Error('unexpected layout');
    }
    expect(variation.body[0].moves[0]?.path).toEqual([0, 1]);
  });

  it('numbers from a start position with Black to move', () => {
    const blocks = buildBlocks(treeFromMoves(['e5', 'Nf3', 'Nc6']), { start: 'b', startNumber: 7 });
    expect(text(blocks)).toBe('7…e5 8.Nf3 Nc6');
  });
});
