/**
 * Custom-position editor (README §7 Phase 4). Shared on purpose: Phase 5's line editor reuses it
 * for a line's starting position, which is why it takes `initialFen` / `onConfirm` / `onCancel` /
 * `confirmLabel` and owns no routing, storage or engine knowledge.
 *
 * All position logic lives in `chess/editor.ts` (README §9); this file is pointer handling,
 * layout and wiring only. Interaction is Pointer Events only, like `Board` (README §8.6):
 *
 *  - tap a palette piece to arm it, then tap squares to place it (the phone-friendly path);
 *  - or drag a palette piece straight onto a square;
 *  - drag a piece between squares to move it, or off the board to remove it;
 *  - or arm "Erase" and tap squares to clear them.
 */

import {
    useCallback,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import styled from 'styled-components';
import {
    CASTLING_RIGHTS,
    canCastle,
    castlingLabel,
    clearBoard,
    fromFen,
    movePiece,
    pieceAt,
    placePiece,
    possibleEnPassantTargets,
    removePiece,
    resetToStart,
    setEnPassant,
    setTurn,
    startModel,
    toFen,
    toggleCastling,
    validate,
    type EditorModel,
    type EditorPiece,
} from '../../chess/editor';
import type { Color } from '../../chess/game';
import {
    isValidFen,
    orderedSquares,
    START_FEN,
    type Orientation,
    type Square,
} from '../../chess/position';
import { Piece } from '../Board/Piece';
import { Button } from '../ui';
import { EditorBoard } from './EditorBoard';
import { PiecePalette, sameTool, type PaletteTool } from './PiecePalette';

export interface PositionEditorProps {
    /** Position to open with. Defaults to the standard start position. */
    initialFen?: string;
    /** Called with the edited FEN when the (validated) position is confirmed. */
    onConfirm: (fen: string) => void;
    /** Omit to hide the cancel button. */
    onCancel?: () => void;
    /** Label of the confirm button. Defaults to 'Start'. */
    confirmLabel?: string;
    /** Board orientation while editing. Defaults to 'white'. */
    orientation?: Orientation;
    className?: string;
}

interface EditorUiState {
    model: EditorModel;
    /** Exactly what is in the FEN field — the user's own text, never reformatted under them. */
    fenText: string;
    /** Structural parse error from typing, if any. */
    fenError: string | null;
}

type DragSource = { kind: 'palette'; piece: EditorPiece } | { kind: 'board'; square: Square };

interface DragRecord {
    pointerId: number;
    source: DragSource;
    startX: number;
    startY: number;
    moved: boolean;
    /** Element holding the pointer capture, so it can be released exactly once. */
    capture: Element | null;
    /** Whether the palette tool was already armed at pointer-down (so a tap can disarm it). */
    wasArmed: boolean;
}

const DRAG_THRESHOLD_PX = 6;

/** The floating piece that follows the pointer during a drag. */
interface GhostState {
    piece: EditorPiece;
    x: number;
    y: number;
    size: number;
    /** Origin square when the drag started on the board, so it can be rendered faded. */
    from: Square | null;
}

function usablePointer(event: ReactPointerEvent<HTMLElement>): boolean {
    return event.isPrimary && !(event.pointerType === 'mouse' && event.button !== 0);
}

function initialState(initialFen: string | undefined): EditorUiState {
    const model = fromFen(initialFen ?? START_FEN) ?? startModel();
    return { model, fenText: toFen(model), fenError: null };
}

export function PositionEditor({
    initialFen,
    onConfirm,
    onCancel,
    confirmLabel = 'Start',
    orientation = 'white',
    className,
}: PositionEditorProps) {
    const [state, setState] = useState<EditorUiState>(() => initialState(initialFen));
    const [tool, setTool] = useState<PaletteTool | null>(null);
    const [ghost, setGhost] = useState<GhostState | null>(null);
    const [hover, setHover] = useState<Square | null>(null);

    const gridRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<DragRecord | null>(null);
    /** Set when a pointer interaction already handled the palette, so the click is a no-op. */
    const suppressClick = useRef(false);

    const { model, fenText, fenError } = state;

    const commitModel = useCallback((next: EditorModel) => {
        setState((prev) =>
            next === prev.model && prev.fenError === null
                ? prev
                : { model: next, fenText: toFen(next), fenError: null },
        );
    }, []);

    const handleFenInput = useCallback((text: string) => {
        const parsed = fromFen(text);
        if (parsed !== null) {
            setState({ model: parsed, fenText: text, fenError: null });
            return;
        }
        const structural = isValidFen(text);
        setState((prev) => ({
            ...prev,
            fenText: text,
            fenError: structural.error ?? 'This is not a valid FEN',
        }));
    }, []);

    /* ------------------------------- pointer plumbing ------------------------------- */

    const squareFromClient = useCallback(
        (clientX: number, clientY: number): Square | null => {
            const grid = gridRef.current;
            if (grid === null) return null;
            const rect = grid.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return null;
            const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
            const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
            if (col < 0 || col > 7 || row < 0 || row > 7) return null;
            return orderedSquares(orientation)[row * 8 + col] ?? null;
        },
        [orientation],
    );

    const squareSize = useCallback((): number => {
        const rect = gridRef.current?.getBoundingClientRect();
        return rect === undefined || rect.width <= 0 ? 48 : rect.width / 8;
    }, []);

    const endDrag = useCallback(() => {
        const record = dragRef.current;
        dragRef.current = null;
        setGhost(null);
        setHover(null);
        if (
            record?.capture instanceof Element &&
            record.capture.hasPointerCapture(record.pointerId)
        ) {
            record.capture.releasePointerCapture(record.pointerId);
        }
        return record;
    }, []);

    const beginDrag = useCallback(
        (source: DragSource, event: ReactPointerEvent<HTMLElement>, wasArmed: boolean) => {
            const target = event.currentTarget;
            try {
                target.setPointerCapture(event.pointerId);
            } catch {
                /* Capture is best-effort; tapping still works without it. */
            }
            dragRef.current = {
                pointerId: event.pointerId,
                source,
                startX: event.clientX,
                startY: event.clientY,
                moved: false,
                capture: target,
                wasArmed,
            };
        },
        [],
    );

    const handlePalettePointerDown = useCallback(
        (piece: EditorPiece, event: ReactPointerEvent<HTMLElement>) => {
            if (!usablePointer(event)) return;
            suppressClick.current = false;
            const wasArmed = sameTool(tool, { kind: 'piece', piece });
            setTool({ kind: 'piece', piece });
            beginDrag({ kind: 'palette', piece }, event, wasArmed);
        },
        [beginDrag, tool],
    );

    const handleSquarePointerDown = useCallback(
        (square: Square, event: ReactPointerEvent<HTMLDivElement>) => {
            if (!usablePointer(event)) return;
            event.preventDefault();
            const grid = gridRef.current;
            if (grid === null) return;
            // Capture on the grid so a drag survives the pointer leaving the board (that is how a
            // piece is dragged off to be removed).
            try {
                grid.setPointerCapture(event.pointerId);
            } catch {
                /* best effort */
            }
            dragRef.current = {
                pointerId: event.pointerId,
                source: { kind: 'board', square },
                startX: event.clientX,
                startY: event.clientY,
                moved: false,
                capture: grid,
                wasArmed: false,
            };
        },
        [],
    );

    const handlePointerMove = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            const record = dragRef.current;
            if (record === null || record.pointerId !== event.pointerId) return;
            if (!record.moved) {
                if (
                    Math.abs(event.clientX - record.startX) < DRAG_THRESHOLD_PX &&
                    Math.abs(event.clientY - record.startY) < DRAG_THRESHOLD_PX
                ) {
                    return;
                }
                record.moved = true;
            }
            const source = record.source;
            const from = source.kind === 'board' ? source.square : null;
            const piece = source.kind === 'palette' ? source.piece : pieceAt(model, source.square);
            if (piece === null) return;
            setGhost({ piece, x: event.clientX, y: event.clientY, size: squareSize(), from });
            setHover(squareFromClient(event.clientX, event.clientY));
        },
        [model, squareFromClient, squareSize],
    );

    const handlePointerUp = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            const record = dragRef.current;
            if (record === null || record.pointerId !== event.pointerId) return;
            endDrag();
            const target = squareFromClient(event.clientX, event.clientY);

            if (record.source.kind === 'palette') {
                // A pointer interaction on the palette always owns the outcome; the click that follows
                // must not toggle the tool a second time.
                suppressClick.current = true;
                if (!record.moved) {
                    if (record.wasArmed) setTool(null);
                    return;
                }
                if (target !== null) commitModel(placePiece(model, target, record.source.piece));
                return;
            }

            const from = record.source.square;
            if (!record.moved) {
                // A tap applies the armed tool. With nothing armed, a tap is inert.
                if (tool === null) return;
                commitModel(
                    tool.kind === 'erase'
                        ? removePiece(model, from)
                        : placePiece(model, from, tool.piece),
                );
                return;
            }
            if (pieceAt(model, from) === null) return;
            // Dropped outside the board: that is the "drag off to remove" gesture.
            if (target === null) commitModel(removePiece(model, from));
            else if (target !== from) commitModel(movePiece(model, from, target));
        },
        [commitModel, endDrag, model, squareFromClient, tool],
    );

    const handlePointerCancel = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            const record = dragRef.current;
            if (record === null || record.pointerId !== event.pointerId) return;
            endDrag();
        },
        [endDrag],
    );

    const handlePaletteSelect = useCallback((next: PaletteTool | null) => {
        if (suppressClick.current) {
            suppressClick.current = false;
            return;
        }
        setTool(next);
    }, []);

    /* ---------------------------------- validation ---------------------------------- */

    const validation = useMemo(() => validate(model), [model]);
    const problem =
        fenError ?? (validation.valid ? null : (validation.error ?? 'Illegal position'));
    const canStart = problem === null;

    const epTargets = useMemo(() => {
        const targets = possibleEnPassantTargets(model);
        // A pasted FEN may carry a target this placement cannot justify: keep it selectable so the
        // control shows the truth (and `validate` explains it).
        if (model.enPassant !== null && !targets.includes(model.enPassant)) {
            return [model.enPassant, ...targets];
        }
        return targets;
    }, [model]);

    return (
        <Wrap className={className}>
            <Columns>
                <BoardColumn>
                    <EditorBoard
                        model={model}
                        orientation={orientation}
                        gridRef={gridRef}
                        draggingFrom={ghost?.from ?? null}
                        hoverSquare={hover}
                        onSquarePointerDown={handleSquarePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerCancel}
                    />
                    <PiecePalette
                        tool={tool}
                        onSelect={handlePaletteSelect}
                        onPiecePointerDown={handlePalettePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerCancel}
                    />
                    <ButtonRow>
                        <Button onClick={() => commitModel(clearBoard(model))}>Clear board</Button>
                        <Button onClick={() => commitModel(resetToStart())}>Reset to start</Button>
                    </ButtonRow>
                </BoardColumn>

                <ControlsColumn>
                    <Field>
                        <FieldLabel htmlFor="position-editor-fen">FEN</FieldLabel>
                        <FenInput
                            id="position-editor-fen"
                            value={fenText}
                            spellCheck={false}
                            autoComplete="off"
                            autoCapitalize="off"
                            $invalid={problem !== null}
                            aria-invalid={problem !== null}
                            data-testid="fen-input"
                            onChange={(event) => handleFenInput(event.target.value)}
                        />
                    </Field>

                    <Field>
                        <FieldLabel as="span">Side to move</FieldLabel>
                        <ChipRow role="group" aria-label="Side to move">
                            {(['w', 'b'] as Color[]).map((color) => (
                                <Chip
                                    key={color}
                                    type="button"
                                    $on={model.turn === color}
                                    aria-pressed={model.turn === color}
                                    data-testid={`turn-${color}`}
                                    onClick={() => commitModel(setTurn(model, color))}
                                >
                                    {color === 'w' ? 'White' : 'Black'}
                                </Chip>
                            ))}
                        </ChipRow>
                    </Field>

                    <Field>
                        <FieldLabel as="span">Castling rights</FieldLabel>
                        <ChipRow role="group" aria-label="Castling rights">
                            {CASTLING_RIGHTS.map((right) => {
                                const on = model.castling[right];
                                const possible = canCastle(model, right);
                                return (
                                    <Chip
                                        key={right}
                                        type="button"
                                        $on={on}
                                        $warn={on && !possible}
                                        aria-pressed={on}
                                        aria-label={castlingLabel(right)}
                                        title={
                                            possible
                                                ? castlingLabel(right)
                                                : `${castlingLabel(right)} — the king or rook is not on its home square`
                                        }
                                        disabled={!possible && !on}
                                        data-testid={`castling-${right}`}
                                        onClick={() => commitModel(toggleCastling(model, right))}
                                    >
                                        {right === 'K' || right === 'k' ? 'O-O' : 'O-O-O'}
                                        <ChipSide>
                                            {right === right.toUpperCase() ? 'white' : 'black'}
                                        </ChipSide>
                                    </Chip>
                                );
                            })}
                        </ChipRow>
                    </Field>

                    <Field>
                        <FieldLabel htmlFor="position-editor-ep">En-passant target</FieldLabel>
                        <Select
                            id="position-editor-ep"
                            value={model.enPassant ?? '-'}
                            data-testid="ep-select"
                            onChange={(event) =>
                                commitModel(
                                    setEnPassant(
                                        model,
                                        event.target.value === '-' ? null : event.target.value,
                                    ),
                                )
                            }
                        >
                            <option value="-">none</option>
                            {epTargets.map((square) => (
                                <option key={square} value={square}>
                                    {square}
                                </option>
                            ))}
                        </Select>
                    </Field>

                    <Status role="status" aria-live="polite" data-testid="position-status">
                        {/* Wording is deliberately neutral: this editor is reused by the line editor to pick
                a line's starting position, not only by Analyze. */}
                        {problem === null ? (
                            <Ok>Legal position.</Ok>
                        ) : (
                            <Problem data-testid="position-error">{problem}</Problem>
                        )}
                    </Status>

                    <ButtonRow>
                        <Button
                            variant="primary"
                            disabled={!canStart}
                            data-testid="confirm-position"
                            onClick={() => {
                                if (canStart) onConfirm(toFen(model));
                            }}
                        >
                            {confirmLabel}
                        </Button>
                        {onCancel !== undefined && <Button onClick={onCancel}>Cancel</Button>}
                    </ButtonRow>
                </ControlsColumn>
            </Columns>

            {ghost !== null && (
                <Ghost
                    aria-hidden="true"
                    style={{
                        left: `${ghost.x}px`,
                        top: `${ghost.y}px`,
                        width: `${ghost.size}px`,
                        height: `${ghost.size}px`,
                    }}
                >
                    <Piece color={ghost.piece.color} type={ghost.piece.type} />
                </Ghost>
            )}
        </Wrap>
    );
}

/* ----------------------------------- styles ----------------------------------- */

const Wrap = styled.div`
    min-width: 0;
`;

const Columns = styled.div`
    display: grid;
    gap: ${(p) => p.theme.space.md};
    grid-template-columns: minmax(0, 1fr);

    @media ${(p) => p.theme.media.wide} {
        /* Both columns are capped: the controls do not need to grow with the window, and a very
       wide FEN field is harder to read, not easier. */
        grid-template-columns: minmax(0, 400px) minmax(280px, 460px);
        justify-content: start;
        align-items: start;
        gap: ${(p) => p.theme.space.lg};
    }
`;

const BoardColumn = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${(p) => p.theme.space.sm};
    min-width: 0;
`;

const ControlsColumn = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${(p) => p.theme.space.md};
    min-width: 0;
`;

const Field = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${(p) => p.theme.space.xs};
    min-width: 0;
`;

const FieldLabel = styled.label`
    font-size: ${(p) => p.theme.font.size.sm};
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: ${(p) => p.theme.color.textMuted};
`;

const FenInput = styled.input<{ $invalid: boolean }>`
    width: 100%;
    min-width: 0;
    padding: ${(p) => p.theme.space.sm};
    background: ${(p) => p.theme.color.bg};
    color: ${(p) => p.theme.color.text};
    border: 1px solid ${(p) => (p.$invalid ? p.theme.color.danger : p.theme.color.border)};
    border-radius: ${(p) => p.theme.radius.md};
    font-family: ${(p) => p.theme.font.mono};
    font-size: ${(p) => p.theme.font.size.sm};

    &:focus-visible {
        outline: 2px solid ${(p) => p.theme.color.focus};
        outline-offset: 1px;
    }
`;

const Select = styled.select`
    align-self: flex-start;
    min-width: 8rem;
    min-height: 40px;
    padding: 0 ${(p) => p.theme.space.sm};
    background: ${(p) => p.theme.color.surfaceAlt};
    color: ${(p) => p.theme.color.text};
    border: 1px solid ${(p) => p.theme.color.border};
    border-radius: ${(p) => p.theme.radius.md};
    font-family: ${(p) => p.theme.font.mono};
    font-size: ${(p) => p.theme.font.size.sm};
`;

const ChipRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: ${(p) => p.theme.space.xs};
    min-width: 0;
`;

const Chip = styled.button<{ $on: boolean; $warn?: boolean }>`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 40px;
    padding: 0 ${(p) => p.theme.space.sm};
    border: 1px solid
        ${(p) =>
            p.$warn === true
                ? p.theme.color.danger
                : p.$on
                  ? p.theme.color.accent
                  : p.theme.color.border};
    border-radius: ${(p) => p.theme.radius.md};
    background: ${(p) => (p.$on ? p.theme.color.accent : p.theme.color.surfaceAlt)};
    color: ${(p) => (p.$on ? p.theme.color.accentText : p.theme.color.text)};
    font-family: inherit;
    font-size: ${(p) => p.theme.font.size.sm};
    font-weight: 600;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    &:focus-visible {
        outline: 2px solid ${(p) => p.theme.color.focus};
        outline-offset: 2px;
    }
`;

const ChipSide = styled.span`
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.04em;
    opacity: 0.8;
`;

const Status = styled.div`
    min-height: 2.5em;
    font-size: ${(p) => p.theme.font.size.sm};
`;

const Ok = styled.span`
    color: ${(p) => p.theme.color.good};
`;

const Problem = styled.span`
    color: ${(p) => p.theme.color.danger};
    font-weight: 600;
`;

const ButtonRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: ${(p) => p.theme.space.sm};
`;

const Ghost = styled.div`
    position: fixed;
    z-index: ${(p) => p.theme.z.dialog};
    transform: translate(-50%, -50%);
    pointer-events: none;
    filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.45));
`;
