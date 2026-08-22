/**
 * Move list + navigation controls (README §7 Phase 2).
 *
 * Presentation only: it holds no game state. It receives the SAN strings and the cursor, and
 * reports the index the user wants to jump to (`-1` = the start position). All history
 * transitions live in `src/chess/history.ts`.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import styled, { css } from 'styled-components';
import { plyColor, plyMoveNumber } from '../../chess/history';
import type { Color } from '../../chess/game';

export interface MoveListProps {
  moves: string[];
  /** Index of the move the board is showing; `-1` = the start position. */
  cursor: number;
  /** `-1` means "jump to the start position". */
  onJump: (index: number) => void;
  /**
   * Side to move in the start position. Optional extra beyond the shared contract: a custom
   * start FEN can have Black to move, in which case the first entry renders as `1... e5`.
   * `moves` alone cannot express that. Defaults to `'w'`.
   */
  startColor?: Color;
  /** Full-move number of the start position (FEN field 6). Defaults to 1. */
  startMoveNumber?: number;
  /** Disables the ArrowLeft/ArrowRight window bindings (e.g. two lists on one screen). */
  keyboardNavigation?: boolean;
  className?: string;
}

interface Row {
  number: number;
  white: { san: string; index: number } | null;
  black: { san: string; index: number } | null;
}

function buildRows(moves: string[], start: Color, startNumber: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < moves.length; i++) {
    const san = moves[i];
    if (san === undefined) continue;
    const color = plyColor(start, i);
    const number = plyMoveNumber(start, startNumber, i);
    let row = rows[rows.length - 1];
    if (row === undefined || color === 'w' || row.black !== null) {
      row = { number, white: null, black: null };
      rows.push(row);
    }
    if (color === 'w') row.white = { san, index: i };
    else row.black = { san, index: i };
  }
  return rows;
}

/** True when the key event came from somewhere the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function MoveList({
  moves,
  cursor,
  onJump,
  startColor = 'w',
  startMoveNumber = 1,
  keyboardNavigation = true,
  className,
}: MoveListProps) {
  const rows = useMemo(
    () => buildRows(moves, startColor, startMoveNumber),
    [moves, startColor, startMoveNumber],
  );

  const last = moves.length - 1;
  const clamped = cursor < -1 ? -1 : cursor > last ? last : cursor;
  const atStart = clamped <= -1;
  const atEnd = clamped >= last;

  const jump = useCallback(
    (index: number) => {
      const target = index < -1 ? -1 : index > last ? last : index;
      if (target !== clamped) onJump(target);
    },
    [clamped, last, onJump],
  );

  // ArrowLeft / ArrowRight, scoped so it never hijacks typing elsewhere in the app.
  useEffect(() => {
    if (!keyboardNavigation) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault(); // also stops the page scrolling sideways
      jump(e.key === 'ArrowLeft' ? clamped - 1 : clamped + 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clamped, jump, keyboardNavigation]);

  // Keep the current move visible. Scrolls the list itself only — never the page.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[data-active="true"]');
    if (!list || !active) return;
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [clamped, rows]);

  return (
    <Wrapper className={className}>
      <List ref={listRef} aria-label="Move list">
        <StartRow
          type="button"
          onClick={() => jump(-1)}
          data-active={atStart}
          $active={atStart}
          aria-current={atStart ? 'true' : undefined}
        >
          Start position
        </StartRow>
        {rows.map((row) => {
          const { white, black } = row;
          return (
            <RowEl key={`${row.number}-${white?.index ?? black?.index ?? 0}`}>
              <Num>
                {row.number}
                {white ? '.' : '...'}
              </Num>
              {white ? (
                <Move
                  type="button"
                  onClick={() => jump(white.index)}
                  data-active={white.index === clamped}
                  $active={white.index === clamped}
                  aria-current={white.index === clamped ? 'true' : undefined}
                >
                  {white.san}
                </Move>
              ) : (
                <span />
              )}
              {black ? (
                <Move
                  type="button"
                  onClick={() => jump(black.index)}
                  data-active={black.index === clamped}
                  $active={black.index === clamped}
                  aria-current={black.index === clamped ? 'true' : undefined}
                >
                  {black.san}
                </Move>
              ) : (
                <span />
              )}
            </RowEl>
          );
        })}
        {rows.length === 0 && <Empty>No moves yet</Empty>}
      </List>

      <Controls role="group" aria-label="Move navigation">
        <Control type="button" onClick={() => jump(-1)} disabled={atStart} aria-label="Start">
          ⏮
        </Control>
        <Control
          type="button"
          onClick={() => jump(clamped - 1)}
          disabled={atStart}
          aria-label="Previous move"
        >
          ◀
        </Control>
        <Control
          type="button"
          onClick={() => jump(clamped + 1)}
          disabled={atEnd}
          aria-label="Next move"
        >
          ▶
        </Control>
        <Control type="button" onClick={() => jump(last)} disabled={atEnd} aria-label="End">
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
  position: relative; /* offsetParent for the keep-in-view maths */
  flex: 1 1 auto;
  min-height: 0;
  max-height: 42vh;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: ${({ theme }) => theme.space.xs};

  @media ${({ theme }) => theme.media.wide} {
    max-height: none;
  }
`;

const RowEl = styled.div`
  display: grid;
  grid-template-columns: 3.25rem 1fr 1fr;
  align-items: stretch;
  gap: ${({ theme }) => theme.space.xs};
  min-width: 0;
`;

const Num = styled.span`
  padding: ${({ theme }) => `${theme.space.xs} 0`};
  color: ${({ theme }) => theme.color.textFaint};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.font.size.sm};
  text-align: right;
  user-select: none;
`;

const activeStyle = css`
  background: ${({ theme }) => theme.color.accent};
  color: ${({ theme }) => theme.color.accentText};
  font-weight: 600;
`;

const clickable = css`
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.font.size.md};

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
  min-width: 0;
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  ${({ $active }) => $active && activeStyle};
  &:hover {
    ${({ $active }) => $active && activeStyle};
  }
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

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
  min-height: 40px; /* comfortable touch target */
  background: ${({ theme }) => theme.color.surfaceAlt};
  color: ${({ theme }) => theme.color.text};
  text-align: center;
  line-height: 1;

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;
