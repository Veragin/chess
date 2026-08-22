import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import styled from 'styled-components';
import { createGame, type Color, type MoveInput, type PromotionPiece } from '../../chess/game';
import {
  fileLabels,
  orderedSquares,
  rankLabels,
  squareShade,
  type Orientation,
  type Square as SquareName,
} from '../../chess/position';
import { Piece, pieceName } from './Piece';
import { PromotionDialog } from './PromotionDialog';
import { Square, type DestinationMarker, type ExtraHighlight } from './Square';

export interface BoardProps {
  fen: string;
  orientation?: Orientation; // default 'white'
  /** null disables interaction entirely (read-only board). */
  onMove?: (m: MoveInput) => void;
  /** Side(s) the user is allowed to move. Omit = both. */
  movableFor?: Color | 'both';
  lastMove?: { from: SquareName; to: SquareName } | null;
  /** Hide all pieces (blind chess). Presentation only. */
  hidePieces?: boolean;
  showCoordinates?: boolean;
  /** Extra square highlights, e.g. a hint or an error flash. */
  highlights?: Partial<Record<SquareName, 'error' | 'hint' | 'success'>>;
}

const ROWS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

const Wrapper = styled.div`
  position: relative;
  width: 100%;
  /* Pointer Events only, everywhere (README §8.6): no browser scroll/zoom gestures on the
     board, and no separate mouse/touch code paths. */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
`;

const Grid = styled.div`
  position: relative;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  width: 100%;
  aspect-ratio: 1;
  /* Lets squares size their coordinates and markers in cqi units, i.e. relative to the
     board itself rather than the viewport. */
  container-type: inline-size;
  border-radius: ${(p) => p.theme.radius.sm};
  overflow: hidden;
  touch-action: none;
`;

/** role="row" wrapper that stays out of the grid layout. */
const GridRow = styled.div`
  display: contents;
`;

const Ghost = styled.div`
  position: absolute;
  z-index: 5;
  width: 12.5%;
  height: 12.5%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.45));
`;

interface DragRecord {
  pointerId: number;
  from: SquareName;
  startX: number;
  startY: number;
  /** True when the same square was already selected at pointer-down (so a tap deselects). */
  wasSelected: boolean;
  /** Flips once the pointer travels past the drag threshold. */
  moved: boolean;
}

interface PendingPromotion {
  from: SquareName;
  to: SquareName;
  color: Color;
}

/**
 * All transient interaction state, tagged with the FEN it belongs to. Tagging (rather than an
 * effect that resets on `fen` change) keeps the reset a pure derivation: a position change
 * simply makes the old selection unreadable.
 */
interface Interaction {
  fen: string;
  selected: SquareName | null;
  pending: PendingPromotion | null;
}

/**
 * Renders a position and owns select/drag interaction plus the promotion dialog. It never owns
 * game state: legality comes from `createGame(fen)` (memoised on `fen`) and every accepted move
 * is reported through `onMove` for the caller to apply.
 */
export function Board({
  fen,
  orientation = 'white',
  onMove,
  movableFor,
  lastMove,
  hidePieces = false,
  showCoordinates = true,
  highlights,
}: BoardProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragRecord | null>(null);
  const [interaction, setInteraction] = useState<Interaction>({
    fen,
    selected: null,
    pending: null,
  });
  const [dragView, setDragView] = useState<{
    fen: string;
    from: SquareName;
    x: number;
    y: number;
  } | null>(null);

  // One Game per FEN — not per render, and never handed out to callers (README §6).
  const derived = useMemo(() => {
    try {
      const game = createGame(fen);
      return { game, pieces: game.pieces(), status: game.status() };
    } catch {
      return { game: null, pieces: [], status: null };
    }
  }, [fen]);

  const { game, status } = derived;
  const turn = status === null ? null : status.turn;

  const pieceBySquare = useMemo(
    () => new Map(derived.pieces.map((p) => [p.square, p])),
    [derived.pieces],
  );

  const squares = useMemo(() => orderedSquares(orientation), [orientation]);
  const files = useMemo(() => fileLabels(orientation), [orientation]);
  const ranks = useMemo(() => rankLabels(orientation), [orientation]);

  const interactive = onMove !== undefined;
  const allowedColor: Color | null =
    movableFor === undefined || movableFor === 'both' ? null : movableFor;
  /** False makes the board read-only: nothing can be picked up and no selection UI appears. */
  const canMove = interactive && turn !== null && (allowedColor === null || allowedColor === turn);

  // A stale (previous-position) or now-forbidden selection simply reads as "nothing selected".
  const selected = interaction.fen === fen && canMove ? interaction.selected : null;
  const pending = interaction.fen === fen ? interaction.pending : null;

  const select = useCallback(
    (square: SquareName | null) => {
      setInteraction({ fen, selected: square, pending: null });
    },
    [fen],
  );

  const clearInteraction = useCallback(() => {
    setInteraction({ fen, selected: null, pending: null });
  }, [fen]);

  // Legal destinations for the selected square: `to` -> is a capture.
  const dests = useMemo(() => {
    const map = new Map<SquareName, boolean>();
    if (!canMove || selected === null || game === null) return map;
    for (const move of game.legalMovesFrom(selected)) {
      map.set(move.to, (map.get(move.to) ?? false) || move.isCapture);
    }
    return map;
  }, [canMove, selected, game]);

  const cancelDrag = useCallback(() => {
    const record = dragRef.current;
    dragRef.current = null;
    setDragView(null);
    const grid = gridRef.current;
    if (record !== null && grid !== null && grid.hasPointerCapture(record.pointerId)) {
      grid.releasePointerCapture(record.pointerId);
    }
  }, []);

  // A drag can only ever be abandoned by the board unmounting; releasing capture there keeps
  // the pointer from staying hostage to a detached element.
  useEffect(() => cancelDrag, [cancelDrag]);

  /** Pointer position relative to the board, plus the board's measured size. */
  const relative = useCallback((clientX: number, clientY: number) => {
    const grid = gridRef.current;
    if (grid === null) return null;
    const rect = grid.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: clientX - rect.left, y: clientY - rect.top, w: rect.width, h: rect.height };
  }, []);

  const squareFromClient = useCallback(
    (clientX: number, clientY: number): SquareName | null => {
      const rel = relative(clientX, clientY);
      if (rel === null) return null;
      const col = Math.floor((rel.x / rel.w) * 8);
      const row = Math.floor((rel.y / rel.h) * 8);
      if (col < 0 || col > 7 || row < 0 || row > 7) return null;
      return squares[row * 8 + col] ?? null;
    },
    [relative, squares],
  );

  /** Applies a move if it is legal, routing promotions through the dialog first. */
  const commit = useCallback(
    (from: SquareName, to: SquareName) => {
      if (game === null || onMove === undefined) return;
      const legal = game.legalMovesFrom(from);
      // Illegal destination: refuse, leave the position and the selection alone.
      if (!legal.some((m) => m.to === to)) return;
      if (game.isPromotion(from, to)) {
        // Nothing is applied until the user picks a piece.
        setInteraction({ fen, selected: from, pending: { from, to, color: game.turn() } });
        return;
      }
      clearInteraction();
      onMove({ from, to });
    },
    [game, onMove, fen, clearInteraction],
  );

  const handlePointerDown = useCallback(
    (square: SquareName, event: ReactPointerEvent<HTMLDivElement>) => {
      if (!interactive || pending !== null) return;
      if (!event.isPrimary) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      if (selected !== null && dests.has(square)) {
        commit(selected, square);
        return;
      }

      const piece = pieceBySquare.get(square);
      const pickable = canMove && piece !== undefined && piece.color === turn;
      if (!pickable) {
        select(null);
        return;
      }

      const grid = gridRef.current;
      const rel = relative(event.clientX, event.clientY);
      if (grid === null || rel === null) return;

      event.preventDefault();
      // Capture so the drag survives the pointer leaving the board entirely.
      try {
        grid.setPointerCapture(event.pointerId);
      } catch {
        /* Capture is best-effort; taps still work without it. */
      }
      dragRef.current = {
        pointerId: event.pointerId,
        from: square,
        startX: rel.x,
        startY: rel.y,
        wasSelected: selected === square,
        moved: false,
      };
      select(square);
    },
    [interactive, pending, selected, dests, commit, pieceBySquare, canMove, turn, relative, select],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const record = dragRef.current;
      if (record === null || event.pointerId !== record.pointerId) return;
      const rel = relative(event.clientX, event.clientY);
      if (rel === null) return;
      if (!record.moved) {
        const threshold = Math.max(4, rel.w / 40);
        if (
          Math.abs(rel.x - record.startX) < threshold &&
          Math.abs(rel.y - record.startY) < threshold
        ) {
          return;
        }
        record.moved = true;
      }
      setDragView({ fen, from: record.from, x: rel.x, y: rel.y });
    },
    [relative, fen],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const record = dragRef.current;
      if (record === null || event.pointerId !== record.pointerId) return;
      cancelDrag();

      if (!record.moved) {
        // A plain tap. Tapping an already-selected piece clears the selection; otherwise the
        // selection set on pointer-down stands (tap-to-select, then tap a destination).
        if (record.wasSelected) select(null);
        return;
      }

      const target = squareFromClient(event.clientX, event.clientY);
      // Dropped off-board or back on the origin: fall back to leaving the piece selected.
      if (target === null || target === record.from) return;
      commit(record.from, target);
    },
    [cancelDrag, squareFromClient, commit, select],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const record = dragRef.current;
      if (record === null || event.pointerId !== record.pointerId) return;
      cancelDrag();
    },
    [cancelDrag],
  );

  const choosePromotion = useCallback(
    (piece: PromotionPiece) => {
      const move = pending;
      clearInteraction();
      if (move === null || onMove === undefined) return;
      onMove({ from: move.from, to: move.to, promotion: piece });
    },
    [pending, onMove, clearInteraction],
  );

  // `hidePieces` means "squares and coordinates only" (README Phase 8). The check glow and the
  // last-move highlight both give away where pieces are, so they are suppressed too — otherwise a
  // blind game leaks the king's square. Caller-supplied `highlights` are deliberate feedback and
  // are left alone.
  const checkedKing = status === null || hidePieces ? null : status.checkedKingSquare;
  const visibleLastMove = hidePieces ? null : lastMove;
  const draggingFrom = dragView !== null && dragView.fen === fen ? dragView.from : null;
  const ghostPiece = draggingFrom === null ? undefined : pieceBySquare.get(draggingFrom);

  return (
    <Wrapper>
      <Grid
        ref={gridRef}
        role="grid"
        aria-label="Chess board"
        data-orientation={orientation}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(event) => event.preventDefault()}
      >
        {ROWS.map((row) => (
          <GridRow role="row" key={row}>
            {ROWS.map((col) => {
              const square = squares[row * 8 + col] as SquareName;
              const piece = pieceBySquare.get(square);
              const marker: DestinationMarker = !dests.has(square)
                ? 'none'
                : dests.get(square) === true
                  ? 'capture'
                  : 'quiet';
              const extra: ExtraHighlight | undefined = highlights?.[square];
              return (
                <Square
                  key={square}
                  square={square}
                  shade={squareShade(square)}
                  selected={selected === square}
                  marker={marker}
                  lastMove={
                    visibleLastMove != null &&
                    (visibleLastMove.from === square || visibleLastMove.to === square)
                  }
                  check={checkedKing === square}
                  extra={extra}
                  grabbable={canMove && piece !== undefined && piece.color === turn}
                  rankLabel={showCoordinates && col === 0 ? ranks[row] : undefined}
                  fileLabel={showCoordinates && row === 7 ? files[col] : undefined}
                  pieceLabel={
                    hidePieces || piece === undefined
                      ? undefined
                      : pieceName(piece.color, piece.type)
                  }
                  onPointerDown={handlePointerDown}
                >
                  {!hidePieces && piece !== undefined && (
                    <Piece
                      color={piece.color}
                      type={piece.type}
                      faded={draggingFrom === square}
                    />
                  )}
                </Square>
              );
            })}
          </GridRow>
        ))}
      </Grid>

      {/* Floating dragged piece. Lives outside the (overflow-hidden) grid so it stays visible
          when the drag leaves the board. Presentation only — hidden with `hidePieces`. */}
      {dragView !== null && draggingFrom !== null && !hidePieces && ghostPiece !== undefined && (
        <Ghost style={{ left: `${dragView.x}px`, top: `${dragView.y}px` }} aria-hidden="true">
          <Piece color={ghostPiece.color} type={ghostPiece.type} />
        </Ghost>
      )}

      {pending !== null && (
        <PromotionDialog
          color={pending.color}
          onSelect={choosePromotion}
          onCancel={clearInteraction}
        />
      )}
    </Wrapper>
  );
}
