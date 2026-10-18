/**
 * Which saved lines pass through a position, and what each of them plays next.
 *
 * This is the whole point of the explore screen: standing in a position, "is this covered?" is
 * the question the repertoire cannot answer by itself, because lines are stored as linear move
 * lists and the same position is reached by more than one of them.
 *
 * Two decisions worth stating:
 *
 *  1. **Positions are matched by transposition, not by move order.** The key is the first four
 *     FEN fields (placement, side to move, castling rights, en-passant square) — the halfmove
 *     clock and the move number are what differ between two routes to the same position and are
 *     deliberately dropped. `chess.js` only writes an en-passant square when the capture is
 *     actually available, so that field is already transposition-safe.
 *  2. **Every line is replayed exactly once**, into an index keyed by position. A repertoire is
 *     small, but the alternative (replaying every line on every board move) makes the panel's
 *     cost grow with the repertoire on each click. Build the index from the line list, hold it,
 *     and each position is then a `Map` lookup.
 *
 *  3. **A move counts if it leads into the repertoire, whoever plays it.** Besides what the
 *     reaching lines play next, every legal move from the position is tried, and one that lands
 *     in a position some line visits is listed too, with those lines. Without this, a line saved
 *     from `…dxc6 d3 Bc5 Be2` has nothing to say after `…dxc6 Be2 Bc5`, although `d3` brings
 *     the board straight back into it.
 *  4. **The whole move tree is indexed**, not just the main line: every node of every line is a
 *     visit to the position it leads to, and every child of that node is a continuation. A line
 *     that reaches the same position along two of its branches and plays the same move next is
 *     still one line playing one move (deduplicated by `line.id + nextSan`).
 *
 * A line whose stored moves do not all replay (only reachable by hand-editing `localStorage`, or
 * by an edited start position) is indexed as far as it goes and reported in `broken`, rather than
 * being dropped silently or throwing: partial coverage is still coverage, and the screen says so.
 * Only the unplayable move's own subtree is lost — its playable siblings are indexed as usual.
 *
 * Pure and DOM-free — no React, no `localStorage` — so it is unit-tested on its own (README §9).
 */


import { createGame, sanToUci } from '../../chess/game';
import { threatMarks, type ThreatMark } from '../../chess/threats';
import { replayTree, type MoveNode, type NodePath } from '../../chess/tree';
import type { Line } from '../../storage/schema';

/** How far past the next move the panel looks for a comment on each branch, in plies. */
export const COMMENT_LOOKAHEAD = 8;

/** The move a line played to arrive in a position, for "why did we play that?" on the board. */
export interface Arrival {
  /** SAN as `chess.js` normalises it. */
  san: string;
  /** `positionKey` of the position the move was played from. */
  fromKey: string;
  comment?: string;
  /** The move's threats (see `chess/threats.ts`), as stored. */
  threats?: string[];
}

/**
 * One line's visit to a position, paired with one of the moves it plays from there. A tree node
 * with three continuations is three reaches; a leaf is one reach with `nextSan: null`.
 */
export interface LineReach {
  line: Line;
  /** Path of the node whose move led here; `[]` for the line's start position. */
  path: NodePath;
  /** Moves already played on the way here (`path.length`). */
  ply: number;
  /** True when the line has nothing more to say here: the node has no continuations. */
  leaf: boolean;
  /** Branches of the line that pass through this position (leaves under the node; 1 at a leaf). */
  branchCount: number;
  /** SAN the line plays next (as `chess.js` normalises it), or `null` at a leaf or a break. */
  nextSan: string | null;
  /** Path of the next move's node; `null` at a leaf. Set for a break too (the unplayable node). */
  nextPath: NodePath | null;
  /** Comment of the next move's node, when it has one. */
  comment?: string;
  /** The stored, unplayable SAN when the next move cannot be played from here. */
  brokenSan?: string;
  /** The move that led here; `null` at the start position. */
  arrival: Arrival | null;
}

/** A comment some line attaches to a move at or after a continuation. */
export interface CoverageComment {
  line: Line;
  text: string;
  /** Normalised SANs from the current position up to and including the commented move. */
  moves: string[];
  /** Path of the commented node in `line.tree`. */
  path: NodePath;
}

/** One continuation the repertoire plays from the position, and who plays it. */
export interface CoverageMove {
  san: string;
  /** Every distinct visit that continues with `san` — one per line (deduplicated by line id). */
  reaches: LineReach[];
  /**
   * Lines that do not play `san` from here but visit the position it leads to (by another move
   * order, or by starting there) — one visit per line. Empty when no other line gets there.
   */
  transpositions: LineReach[];
  /** True when no reaching line plays `san` here: it is listed only because of `transpositions`. */
  transposes: boolean;
  /** Distinct lines behind `reaches` and `transpositions`, sorted by name — what the UI counts. */
  lines: Line[];
  /**
   * What the lines say about this continuation: on each branch, the first comment found from the
   * next move on (at most `COMMENT_LOOKAHEAD` plies deep). Sorted by line name, nearest first.
   */
  comments: CoverageComment[];
}

export interface Coverage {
  /** Every visit to the position, deduplicated by `line.id + nextSan`, line name first. */
  reaching: LineReach[];
  /** Distinct lines that pass through it, sorted by name. */
  lines: Line[];
  /** Continuations, most-played first. */
  moves: CoverageMove[];
  /** Lines with a branch that ends exactly here. */
  endsHere: LineReach[];
  /** Lines that reach here but whose next stored move cannot be played (a damaged line). */
  breaksHere: LineReach[];
}

/** A line that could not be replayed in full, and where it first gave up. */
export interface BrokenLine {
  line: Line;
  /** 0-based ply of the first unplayable move; `null` when the start position itself is illegal. */
  failedAtPly: number | null;
  /** Path of that move in `line.tree`; `[]` when the start position itself is illegal. */
  path: NodePath;
}

export interface CoverageIndex {
  /** `positionKey` → every visit to that position. */
  byPosition: Map<string, LineReach[]>;
  /** How many lines went into the index, damaged ones included. */
  lineCount: number;
  broken: BrokenLine[];
  /** Per line id: `pathKey` → normalised SAN of every playable node (for comment look-ahead). */
  sanAt: Map<string, Map<string, string>>;
}

export const EMPTY_COVERAGE: Coverage = {
  reaching: [],
  lines: [],
  moves: [],
  endsHere: [],
  breaksHere: [],
};

/**
 * Position identity for transposition matching: placement, side to move, castling rights and the
 * en-passant square. Total — a malformed FEN yields a key that simply matches nothing real.
 */
export function positionKey(fen: string): string {
  const fields = typeof fen === 'string' ? fen.trim().split(/\s+/) : [];
  const placement = fields[0] ?? '';
  const turn = fields[1] === 'b' ? 'b' : 'w';
  const castling = fields[2] ?? '-';
  const enPassant = fields[3] ?? '-';
  return `${placement} ${turn} ${castling} ${enPassant}`;
}

function pathKey(path: NodePath): string {
  return path.join('.');
}

function byName(a: Line, b: Line): number {
  const byLabel = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return byLabel !== 0 ? byLabel : a.id.localeCompare(b.id);
}

/** Code-point order, not locale order: SAN is notation, and the tie-break must be the same
 *  everywhere. `localeCompare` would order `Nf3` against `e4` differently per ICU build. */
function bySan(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Lexicographic order of tree paths, so depth-first order wins ties. */
function byPath(a: NodePath, b: NodePath): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function byReach(a: LineReach, b: LineReach): number {
  return (
    byName(a.line, b.line) ||
    a.ply - b.ply ||
    byPath(a.path, b.path) ||
    byPath(a.nextPath ?? [], b.nextPath ?? [])
  );
}

/** Distinct lines behind a set of visits, sorted by name. */
function distinctLines(reaches: readonly LineReach[]): Line[] {
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const reach of reaches) {
    if (seen.has(reach.line.id)) continue;
    seen.add(reach.line.id);
    out.push(reach.line);
  }
  return out.sort(byName);
}

function leafCount(children: readonly MoveNode[]): number {
  if (children.length === 0) return 1;
  return children.reduce((sum, child) => sum + leafCount(child.next), 0);
}

function push(byPosition: Map<string, LineReach[]>, key: string, reach: LineReach): void {
  const bucket = byPosition.get(key);
  if (bucket === undefined) byPosition.set(key, [reach]);
  else bucket.push(reach);
}

/**
 * Replays every line's whole tree once and indexes each position it visits, its own start
 * position included. Call this on the line list (memoised), not per board move.
 */
export function buildCoverageIndex(lines: readonly Line[]): CoverageIndex {
  const byPosition = new Map<string, LineReach[]>();
  const broken: BrokenLine[] = [];
  const sanAt = new Map<string, Map<string, string>>();

  for (const line of lines) {
    let startFen: string;
    try {
      startFen = createGame(line.startFen).fen();
    } catch {
      // Not a position at all: there is nothing to index, but the screen must be able to say so.
      broken.push({ line, failedAtPly: null, path: [] });
      continue;
    }

    const tree = Array.isArray(line.tree) ? line.tree : [];
    const replay = replayTree(startFen, tree);
    if (replay.broken !== null) {
      const path = replay.broken.path;
      broken.push({ line, failedAtPly: path.length === 0 ? null : path.length - 1, path });
    }

    // Replayed nodes keep their original paths, so a missing path is an unplayable node.
    const played = new Map(replay.nodes.map((node) => [pathKey(node.path), node]));
    const sans = new Map<string, string>();
    for (const [key, node] of played) sans.set(key, node.san);
    sanAt.set(line.id, sans);

    const visit = (
      children: readonly MoveNode[],
      path: NodePath,
      fen: string,
      arrival: Arrival | null,
    ): void => {
      const key = positionKey(fen);
      const base = { line, path, ply: path.length, branchCount: leafCount(children), arrival };
      if (children.length === 0) {
        push(byPosition, key, { ...base, leaf: true, nextSan: null, nextPath: null });
        return;
      }
      children.forEach((child, i) => {
        const nextPath = [...path, i];
        const node = played.get(pathKey(nextPath));
        const commented = child.comment !== undefined && child.comment.trim().length > 0;
        if (node === undefined) {
          push(byPosition, key, {
            ...base,
            leaf: false,
            nextSan: null,
            nextPath,
            brokenSan: String(child.san),
          });
          return;
        }
        const reach: LineReach = { ...base, leaf: false, nextSan: node.san, nextPath };
        if (commented) reach.comment = child.comment;
        push(byPosition, key, reach);

        const next: Arrival = { san: node.san, fromKey: key };
        if (commented) next.comment = child.comment;
        if (child.threats !== undefined && child.threats.length > 0) next.threats = child.threats;
        visit(child.next, nextPath, node.fenAfter, next);
      });
    };
    visit(tree, [], startFen, null);
  }

  return { byPosition, lineCount: lines.length, broken, sanAt };
}

/**
 * On each branch from `reach`'s next move on, the first commented move within
 * `COMMENT_LOOKAHEAD` plies, with the moves that lead to it from the current position.
 */
function upcomingComments(
  index: CoverageIndex,
  reach: LineReach,
  /** Moves from the current position to `reach`'s position (a transposing move), if any. */
  prefix: readonly string[] = [],
): CoverageComment[] {
  const sans = index.sanAt.get(reach.line.id);
  if (sans === undefined || reach.nextPath === null) return [];
  const out: CoverageComment[] = [];
  const walk = (node: MoveNode, path: NodePath, moves: readonly string[]): void => {
    const san = sans.get(pathKey(path));
    if (san === undefined) return; // unplayable: nothing after it is real
    const here = [...moves, san];
    if (node.comment !== undefined && node.comment.trim().length > 0) {
      out.push({ line: reach.line, text: node.comment, moves: here, path });
      return;
    }
    if (here.length >= COMMENT_LOOKAHEAD) return;
    node.next.forEach((child, i) => walk(child, [...path, i], here));
  };
  let node: MoveNode | undefined;
  let children: readonly MoveNode[] = reach.line.tree;
  for (const step of reach.nextPath) {
    node = children[step];
    if (node === undefined) return [];
    children = node.next;
  }
  if (node !== undefined) walk(node, reach.nextPath, prefix);
  return out;
}

function dedupeComments(comments: readonly CoverageComment[]): CoverageComment[] {
  const seen = new Set<string>();
  const out: CoverageComment[] = [];
  for (const c of comments) {
    const key = `${c.line.id}\u0000${c.moves.join(' ')}\u0000${c.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.sort(
    (a, b) => byName(a.line, b.line) || a.moves.length - b.moves.length || byPath(a.path, b.path),
  );
}

/** Identity of a reach for deduplication: one line, one thing it does next. */
function reachKey(reach: LineReach): string {
  let next = reach.leaf ? '#end' : `!${reach.brokenSan ?? ''}`;
  if (reach.nextSan !== null) next = `+${reach.nextSan}`;
  return `${reach.line.id}\u0000${next}`;
}

/** What the repertoire does in the position `fen` — the panel's whole input. */
export function coverageAt(index: CoverageIndex, fen: string): Coverage {
  const found = index.byPosition.get(positionKey(fen)) ?? [];
  const transposing = transposingMoves(index, fen);
  if (found.length === 0 && transposing.size === 0) return EMPTY_COVERAGE;

  const all = found.slice().sort(byReach);

  // Comments come from every visit, before deduplication: two branches that reach here and play
  // the same move may still say different things further on.
  const commentsBySan = new Map<string, CoverageComment[]>();
  for (const reach of all) {
    if (reach.nextSan === null) continue;
    const bucket = commentsBySan.get(reach.nextSan) ?? [];
    bucket.push(...upcomingComments(index, reach));
    commentsBySan.set(reach.nextSan, bucket);
  }

  const seen = new Set<string>();
  const reaching = all.filter((reach) => {
    const key = reachKey(reach);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const grouped = new Map<string, LineReach[]>();
  const endsHere: LineReach[] = [];
  const breaksHere: LineReach[] = [];
  for (const reach of reaching) {
    if (reach.nextSan === null) {
      if (reach.leaf) endsHere.push(reach);
      else breaksHere.push(reach);
      continue;
    }
    const bucket = grouped.get(reach.nextSan);
    if (bucket === undefined) grouped.set(reach.nextSan, [reach]);
    else bucket.push(reach);
  }

  const sans = new Set([...grouped.keys(), ...transposing.keys()]);
  const moves: CoverageMove[] = [...sans]
    .map((san) => {
      const reaches = grouped.get(san) ?? [];
      const direct = new Set(reaches.map((reach) => reach.line.id));
      // Lines that already play `san` here are counted once, through their own move.
      const others = (transposing.get(san) ?? []).filter((reach) => !direct.has(reach.line.id));
      const comments = [...(commentsBySan.get(san) ?? [])];
      for (const reach of others) comments.push(...upcomingComments(index, reach, [san]));
      return {
        san,
        reaches,
        transpositions: dedupeByLine(others),
        transposes: reaches.length === 0,
        lines: distinctLines([...reaches, ...others]),
        comments: dedupeComments(comments),
      };
    })
    // Most-played first so the main line leads; a line's own move before a transposition into
    // it; alphabetical within a tie keeps it stable.
    .sort(
      (a, b) =>
        b.lines.length - a.lines.length ||
        Number(a.transposes) - Number(b.transposes) ||
        bySan(a.san, b.san),
    );

  return {
    reaching,
    lines: distinctLines(reaching),
    moves,
    endsHere,
    breaksHere: dedupeByLine(breaksHere),
  };
}

/**
 * Every legal move from `fen` that lands in a position the index knows, with the visits to that
 * position (line name first). One replay of the legal moves per call — a few dozen moves.
 */
function transposingMoves(index: CoverageIndex, fen: string): Map<string, LineReach[]> {
  const out = new Map<string, LineReach[]>();
  let game;
  try {
    game = createGame(fen);
  } catch {
    return out;
  }
  for (const legal of game.legalMoves()) {
    const played = game.move(legal.san);
    if (played === null) continue;
    const found = index.byPosition.get(positionKey(game.fen()));
    game.undo();
    if (found !== undefined && found.length > 0) out.set(played.san, found.slice().sort(byReach));
  }
  return out;
}

/** One entry per line: the panel names lines, and a line that breaks here twice is still one. */
function dedupeByLine(reaches: readonly LineReach[]): LineReach[] {
  const seen = new Set<string>();
  return reaches.filter((reach) => {
    if (seen.has(reach.line.id)) return false;
    seen.add(reach.line.id);
    return true;
  });
}

/**
 * Comments on the move that led to the board's position `fen`, from every line that played that
 * same move (`lastMove.san`) from the same position (`lastMove.fenBefore`) — the board's last
 * move matched against the nodes of the lines that reach `fen`. Empty at the start position.
 */
export function arrivalComments(
  index: CoverageIndex,
  fen: string,
  lastMove: { san: string; fenBefore: string } | null,
): { line: Line; text: string }[] {
  if (lastMove === null) return [];
  const found = index.byPosition.get(positionKey(fen));
  if (found === undefined) return [];
  const fromKey = positionKey(lastMove.fenBefore);
  const seen = new Set<string>();
  const out: { line: Line; text: string }[] = [];
  for (const reach of found.slice().sort(byReach)) {
    const arrival = reach.arrival;
    if (arrival === null || arrival.comment === undefined) continue;
    if (arrival.san !== lastMove.san || arrival.fromKey !== fromKey) continue;
    const key = `${reach.line.id}\u0000${arrival.comment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ line: reach.line, text: arrival.comment });
  }
  return out;
}

/**
 * Threats of the board's position `fen`: those of the move that led there (matched as in
 * `arrivalComments`), united over every line that played it. Empty at the start position.
 */
export function arrivalThreats(
  index: CoverageIndex,
  fen: string,
  lastMove: { san: string; fenBefore: string } | null,
): ThreatMark[] {
  if (lastMove === null) return [];
  const found = index.byPosition.get(positionKey(fen));
  if (found === undefined) return [];
  const fromKey = positionKey(lastMove.fenBefore);
  const moves: string[] = [];
  for (const reach of found.slice().sort(byReach)) {
    const arrival = reach.arrival;
    if (arrival === null || arrival.threats === undefined) continue;
    if (arrival.san !== lastMove.san || arrival.fromKey !== fromKey) continue;
    for (const move of arrival.threats) if (!moves.includes(move)) moves.push(move);
  }
  return threatMarks(fen, moves);
}

/** Which side's lines count: those trained for White, for Black, or every line. */
export type TrainedFor = 'w' | 'b' | 'both';

/** The lines trained for `side` (`'both'` keeps them all). */
export function linesTrainedFor(lines: readonly Line[], side: TrainedFor): Line[] {
  return side === 'both' ? lines.slice() : lines.filter((line) => line.userColor === side);
}

/** The side the lines behind a move are trained for: one colour, or `'both'` when they mix. */
function sideOf(lines: readonly Line[]): TrainedFor {
  const white = lines.some((line) => line.userColor === 'w');
  const black = lines.some((line) => line.userColor === 'b');
  if (white && !black) return 'w';
  if (black && !white) return 'b';
  return 'both';
}

/** A continuation drawn on the board: squares from the move, prominence from its line count. */
export interface CoverageArrow {
  san: string;
  from: string;
  to: string;
  /** Lines playing this move relative to the most-played continuation, in (0, 1]. */
  weight: number;
  /** Who the lines behind the move are trained for — the arrow's outline. */
  side: TrainedFor;
}

/**
 * The repertoire's continuations from `fen` as board arrows, most-played first. A SAN that does
 * not play from `fen` (cannot happen for an index built from the same position) is skipped.
 */
export function coverageArrows(coverage: Coverage, fen: string): CoverageArrow[] {
  const most = coverage.moves.reduce((max, move) => Math.max(max, move.lines.length), 0);
  const out: CoverageArrow[] = [];
  for (const move of coverage.moves) {
    const uci = sanToUci(fen, move.san);
    if (uci === null) continue;
    out.push({
      san: move.san,
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      weight: most === 0 ? 1 : move.lines.length / most,
      side: sideOf(move.lines),
    });
  }
  return out;
}
