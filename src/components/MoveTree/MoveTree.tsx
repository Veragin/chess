/**
 * Move *tree* view + navigation controls — the line editor's counterpart of `MoveList`.
 *
 * Presentation only: it receives the tree and the cursor and reports the path the user wants to
 * go to (`[]` = the start position). The main line flows inline, PGN-style
 * (`1.e4 e5 2.Nf3 …`); every alternative is an indented `( … )` block right after the move it is
 * an alternative to, nested as deep as the tree goes, after which the main line resumes with its
 * move number. Moves with a comment carry a small marker (the comment is its tooltip).
 *
 * Keyboard: ArrowLeft = parent move, ArrowRight = main continuation, ArrowUp / ArrowDown = previous
 * / next sibling (switch between alternatives). Ignored while the user is typing somewhere.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import styled, { css } from 'styled-components';
import type { Color } from '../../chess/game';
import { childrenAt, type MoveTree as Tree, type NodePath } from '../../chess/tree';
import { clampPath, endOfLine } from '../../chess/treeHistory';
import { buildBlocks, type Block } from './layout';

export interface MoveTreeProps {
  tree: Tree;
  /** The node the board shows; `[]` = the start position. */
  cursor: NodePath;
  onSelect: (path: NodePath) => void;
  /** Side to move in the start position. Defaults to `'w'`. */
  startColor?: Color;
  /** Full-move number of the start position (FEN field 6). Defaults to 1. */
  startMoveNumber?: number;
  /** Disables the window arrow-key bindings. */
  keyboardNavigation?: boolean;
  className?: string;
}

function samePath(a: NodePath, b: NodePath): boolean {
  return a.length === b.length && a.every((step, i) => step === b[i]);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function MoveTree({
  tree,
  cursor,
  onSelect,
  startColor = 'w',
  startMoveNumber = 1,
  keyboardNavigation = true,
  className,
}: MoveTreeProps) {
  const blocks = useMemo(
    () => buildBlocks(tree, { start: startColor, startNumber: startMoveNumber }),
    [tree, startColor, startMoveNumber],
  );

  const current = useMemo(() => clampPath(tree, cursor), [tree, cursor]);
  const currentKey = current.join('.');
  const atStart = current.length === 0;
  const atEnd = childrenAt(tree, current).length === 0;

  const select = useCallback(
    (path: NodePath) => {
      const target = clampPath(tree, path);
      if (!samePath(target, current)) onSelect(target);
    },
    [current, onSelect, tree],
  );

  const back = useCallback(() => select(current.slice(0, -1)), [current, select]);
  const forward = useCallback(() => {
    if (!atEnd) select([...current, 0]);
  }, [atEnd, current, select]);
  const toEnd = useCallback(() => select(endOfLine(tree, current)), [current, select, tree]);
  /** Switches to the previous / next alternative; false when there is none (key not handled). */
  const sibling = useCallback(
    (delta: number): boolean => {
      if (current.length === 0) return false;
      const parent = current.slice(0, -1);
      const index = (current[current.length - 1] as number) + delta;
      if (index < 0 || index >= childrenAt(tree, parent).length) return false;
      select([...parent, index]);
      return true;
    },
    [current, select, tree],
  );

  useEffect(() => {
    if (!keyboardNavigation) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === 'ArrowLeft') back();
      else if (e.key === 'ArrowRight') forward();
      // Up/Down only when there is an alternative to switch to — otherwise the page scrolls.
      else if (e.key === 'ArrowUp' ? !sibling(-1) : e.key === 'ArrowDown' ? !sibling(1) : true) {
        return;
      }
      e.preventDefault(); // also stops the page scrolling
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [back, forward, keyboardNavigation, sibling]);

  // Keep the current move visible. Scrolls the list itself only — never the page.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[data-active="true"]');
    if (!list || !active) return;
    const listBox = list.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.top < listBox.top) list.scrollTop -= listBox.top - box.top;
    else if (box.bottom > listBox.bottom) list.scrollTop += box.bottom - listBox.bottom;
  }, [currentKey, blocks]);

  const renderBlocks = (items: Block[], depth: number) =>
    items.map((block) =>
      block.kind === 'run' ? (
        <Run key={block.key}>
          {block.moves.map((move) => {
            const active = move.key === currentKey;
            return (
              <Move
                key={move.key}
                type="button"
                onClick={() => select(move.path)}
                data-active={active}
                data-testid={`tree-move-${move.key}`}
                $active={active}
                aria-current={active ? 'true' : undefined}
                title={move.comment}
              >
                {move.number !== '' && <Num>{move.number}</Num>}
                {move.san}
                {move.comment !== undefined && (
                  <CommentMark aria-label="has a comment" $active={active} />
                )}
              </Move>
            );
          })}
        </Run>
      ) : (
        <Variation key={block.key} $depth={depth}>
          <Paren aria-hidden="true">(</Paren>
          {renderBlocks(block.body, depth + 1)}
          <Paren aria-hidden="true">)</Paren>
        </Variation>
      ),
    );

  return (
    <Wrapper className={className}>
      <List ref={listRef} aria-label="Move tree">
        <StartRow
          type="button"
          onClick={() => select([])}
          data-active={atStart}
          $active={atStart}
          aria-current={atStart ? 'true' : undefined}
        >
          Start position
        </StartRow>
        {tree.length === 0 ? <Empty>No moves yet</Empty> : renderBlocks(blocks, 0)}
      </List>

      <Controls role="group" aria-label="Move navigation">
        <Control type="button" onClick={() => select([])} disabled={atStart} aria-label="Start">
          ⏮
        </Control>
        <Control type="button" onClick={back} disabled={atStart} aria-label="Previous move">
          ◀
        </Control>
        <Control type="button" onClick={forward} disabled={atEnd} aria-label="Next move">
          ▶
        </Control>
        <Control type="button" onClick={toEnd} disabled={atEnd} aria-label="End of this line">
          ⏭
        </Control>
      </Controls>
    </Wrapper>
  );
}

/* ---------------------------------- styles ---------------------------------- */

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  color: ${({ theme }) => theme.color.text};
  font-family: ${({ theme }) => theme.font.body};
`;

const List = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  max-height: 42vh;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: ${({ theme }) => theme.space.xs};

  @media ${({ theme }) => theme.media.wide} {
    max-height: 48vh;
  }
`;

const Run = styled.div`
  display: inline;
`;

const Variation = styled.div<{ $depth: number }>`
  margin: ${({ theme }) => `${theme.space.xs} 0 ${theme.space.xs} ${theme.space.md}`};
  padding-left: ${({ theme }) => theme.space.xs};
  border-left: 2px solid ${({ theme }) => theme.color.border};
  color: ${({ theme, $depth }) => ($depth === 0 ? theme.color.text : theme.color.textMuted)};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

const Paren = styled.span`
  color: ${({ theme }) => theme.color.textFaint};
  font-family: ${({ theme }) => theme.font.mono};
  padding: 0 2px;
  user-select: none;
`;

const Num = styled.span`
  margin-right: 2px;
  color: ${({ theme }) => theme.color.textFaint};
  font-weight: 400;
  user-select: none;
`;

const activeStyle = css`
  background: ${({ theme }) => theme.color.accent};
  color: ${({ theme }) => theme.color.accentText};
  font-weight: 600;

  ${Num} {
    color: inherit;
  }
`;

const clickable = css`
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-family: ${({ theme }) => theme.font.mono};

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.color.surfaceAlt};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.focus};
    outline-offset: -2px;
  }
`;

const Move = styled.button<{ $active: boolean }>`
  ${clickable};
  display: inline-flex;
  align-items: center;
  margin: 1px;
  padding: ${({ theme }) => `2px ${theme.space.xs}`};
  font-size: inherit;
  white-space: nowrap;

  ${({ $active }) => $active && activeStyle};
  &:hover {
    ${({ $active }) => $active && activeStyle};
  }
`;

const CommentMark = styled.span<{ $active: boolean }>`
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 3px;
  border-radius: 50%;
  background: ${({ theme, $active }) => ($active ? theme.color.accentText : theme.color.accent)};
  vertical-align: super;
`;

const StartRow = styled.button<{ $active: boolean }>`
  ${clickable};
  display: block;
  width: 100%;
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  margin-bottom: ${({ theme }) => theme.space.xs};
  font-family: ${({ theme }) => theme.font.body};
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textMuted};
  text-align: left;

  ${({ $active }) => $active && activeStyle};
  &:hover {
    ${({ $active }) => $active && activeStyle};
  }
`;

const Empty = styled.p`
  margin: 0;
  padding: ${({ theme }) => theme.space.sm};
  color: ${({ theme }) => theme.color.textFaint};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

const Controls = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: ${({ theme }) => theme.space.xs};
  flex: 0 0 auto;
  padding: ${({ theme }) => theme.space.xs};
  border-top: 1px solid ${({ theme }) => theme.color.border};
`;

const Control = styled.button`
  ${clickable};
  padding: ${({ theme }) => theme.space.sm};
  min-height: 40px;
  background: ${({ theme }) => theme.color.surfaceAlt};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.md};
  text-align: center;
  line-height: 1;

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;
