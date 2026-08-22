/**
 * Pure spoken-move grammar (README §7 Phase 8, step 2–4).
 *
 * Design rule from the spec: **do not parse the transcript into SAN and hope.** A transcript is
 * turned into a loose `MoveIntent` (piece, origin hints, destination, capture, promotion,
 * castling) and that intent is used to *filter the legal move list*. Exactly one survivor means
 * the move is resolved; zero or several means we move on to the next `SpeechRecognition`
 * alternative and, if they all fail, report `unrecognised` / `ambiguous` without touching the
 * position.
 *
 * This module must stay free of every browser API — it is unit-tested in a `node` environment
 * and must never import `recognizer.ts` / `speak.ts`.
 */

import type { LegalMove, PieceType, PromotionPiece } from '../chess/game';
import type { Square } from '../chess/position';

export type ResolveOutcome =
  | { status: 'resolved'; san: string; move: LegalMove; spoken: string }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'unrecognised' };

export interface MoveIntent {
  piece?: PieceType;
  fromFile?: string;
  fromRank?: string;
  to?: Square;
  capture?: boolean;
  promotion?: PromotionPiece;
  castle?: 'short' | 'long';
  /**
   * Set when the speaker said "castles" without naming a side. The side is then decided by the
   * legal move list: one castle available resolves, two are `ambiguous`. (Additive optional
   * field on top of the pinned contract — every pinned field keeps its exact meaning.)
   */
  castleAnySide?: boolean;
}

const SQUARE_RE = /^[a-h][1-8]$/;
const FILE_RE = /^[a-h]$/;
const RANK_RE = /^[1-8]$/;

/**
 * Homophone / synonym table. Every mapping listed in README §7 Phase 8 step 2 is present and
 * authoritative; the rest are obvious mishearings of the same vocabulary.
 *
 * `to` / `too` are deliberately absent — they are handled contextually in `normaliseTranscript`
 * because "rook to d1" and "promotes to queen" use them as English prepositions while
 * "d to" means d2. `two` always means 2.
 */
const HOMOPHONES: Readonly<Record<string, string>> = {
  // --- piece names -------------------------------------------------------------
  knight: 'knight',
  knights: 'knight',
  night: 'knight',
  nights: 'knight',
  nite: 'knight',
  bishop: 'bishop',
  bishops: 'bishop',
  bishoff: 'bishop',
  rook: 'rook',
  rooks: 'rook',
  rock: 'rook',
  rocks: 'rook',
  brook: 'rook',
  queen: 'queen',
  queens: 'queen',
  quinn: 'queen',
  king: 'king',
  kings: 'king',
  pawn: 'pawn',
  pawns: 'pawn',
  prawn: 'pawn',

  // --- capture -----------------------------------------------------------------
  takes: 'takes',
  take: 'takes',
  taking: 'takes',
  took: 'takes',
  capture: 'takes',
  captures: 'takes',
  captured: 'takes',
  capturing: 'takes',
  x: 'takes',
  ex: 'takes',
  axe: 'takes',
  ax: 'takes',

  // --- castling ----------------------------------------------------------------
  castles: 'castles',
  castle: 'castles',
  castled: 'castles',
  castling: 'castles',
  kingside: 'short',
  queenside: 'long',
  short: 'short',
  long: 'long',
  oh: 'o',

  // --- promotion ---------------------------------------------------------------
  promotes: 'promotes',
  promote: 'promotes',
  promoted: 'promotes',
  promoting: 'promotes',
  promotion: 'promotes',
  equals: 'promotes',
  equal: 'promotes',

  // --- file letters ------------------------------------------------------------
  a: 'a',
  ay: 'a',
  aye: 'a',
  b: 'b',
  be: 'b',
  bee: 'b',
  c: 'c',
  see: 'c',
  sea: 'c',
  cee: 'c',
  e: 'e',
  ee: 'e',
  d: 'd',
  dee: 'd',
  f: 'f',
  ef: 'f',
  eff: 'f',
  g: 'g',
  gee: 'g',
  jee: 'g',
  h: 'h',
  aitch: 'h',
  haitch: 'h',
  each: 'h',
  q: 'q',
  queue: 'q',
  cue: 'q',

  // --- rank digits -------------------------------------------------------------
  one: '1',
  won: '1',
  two: '2',
  three: '3',
  tree: '3',
  four: '4',
  for: '4',
  fore: '4',
  five: '5',
  six: '6',
  sicks: '6',
  sics: '6',
  seven: '7',
  eight: '8',
  ate: '8',
  nine: '9',
  zero: '0',
};

/** Dropped outright: connective English that carries no move information. */
const FILLERS: ReadonlySet<string> = new Set([
  'please',
  'the',
  'my',
  'me',
  'i',
  'im',
  'it',
  'its',
  'is',
  'and',
  'then',
  'now',
  'next',
  'ok',
  'okay',
  'um',
  'uh',
  'er',
  'ah',
  'lets',
  'let',
  'us',
  'we',
  'you',
  'your',
  'do',
  'does',
  'put',
  'move',
  'moves',
  'moved',
  'moving',
  'play',
  'plays',
  'played',
  'go',
  'goes',
  'going',
  'from',
  'on',
  'at',
  'in',
  'into',
  'onto',
  'of',
  'square',
  'piece',
  'side',
  'check',
  'checkmate',
  'mate',
]);

const PIECE_WORDS: Readonly<Record<string, PieceType>> = {
  king: 'k',
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
  pawn: 'p',
  // Bare letters that cannot be confused with a file: 'b' and 'p' are excluded on purpose.
  k: 'k',
  q: 'q',
  r: 'r',
  n: 'n',
};

const PROMOTION_WORDS: Readonly<Record<string, PromotionPiece>> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
  q: 'q',
  r: 'r',
  n: 'n',
};

const PIECE_LETTER_WORD: Readonly<Record<string, string>> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
};

const PIECE_NAMES: Readonly<Record<PieceType, string>> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};

const CASTLE_WORD = 'castles';

/**
 * Splits a token the recogniser produced in notation form ('nf3', 'bxc6', 'exd5', 'e8=q',
 * 'o-o' → 'oo') into spoken words, so the rest of the pipeline only ever sees words, squares,
 * bare files and bare ranks.
 */
function expandNotationToken(word: string): string[] {
  if (word.length <= 1) return [word];
  if (SQUARE_RE.test(word)) return [word];

  if (/^[o0]{2,3}$/.test(word)) {
    return [CASTLE_WORD, word.length === 2 ? 'short' : 'long'];
  }

  // Full SAN, with or without a disambiguator and a promotion: 'nf3', 'rad1', 'r1a3', 'bxc6',
  // 'exd5', 'e8q'. The '=' of 'e8=Q' has already been stripped as punctuation.
  const san = /^([kqrbn])?([a-h]|[1-8])?(x)?([a-h][1-8])=?([qrbn])?$/.exec(word);
  if (san !== null) {
    const [, piece, disambiguator, capture, square, promotion] = san;
    const out: string[] = [];
    if (piece !== undefined) {
      const name = PIECE_LETTER_WORD[piece];
      if (name !== undefined) out.push(name);
    }
    // A bare file/rank becomes an origin hint further down the pipeline.
    if (disambiguator !== undefined) out.push(disambiguator);
    if (capture !== undefined) out.push('takes');
    if (square !== undefined) out.push(square);
    if (promotion !== undefined) {
      const name = PIECE_LETTER_WORD[promotion];
      if (name !== undefined) out.push('promotes', name);
    }
    return out;
  }

  return [word];
}

/** 'o o' / '0 0 0' → castling words. A lone 'o' is left alone. */
function collapseCastleNotation(tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === undefined) break;
    if (tok === 'o' || tok === '0') {
      let j = i;
      while (j < tokens.length) {
        const next = tokens[j];
        if (next !== 'o' && next !== '0') break;
        j += 1;
      }
      const run = j - i;
      if (run === 2) out.push(CASTLE_WORD, 'short');
      else if (run >= 3) out.push(CASTLE_WORD, 'long');
      else out.push(tok);
      i = j;
      continue;
    }
    out.push(tok);
    i += 1;
  }
  return out;
}

/** 'e' + '4' → 'e4'. Number words must survive as squares (README §7 Phase 8 step 2). */
function mergeSquares(tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === undefined) break;
    const next = tokens[i + 1];
    if (FILE_RE.test(tok) && next !== undefined && RANK_RE.test(next)) {
      out.push(tok + next);
      i += 2;
      continue;
    }
    out.push(tok);
    i += 1;
  }
  return out;
}

/**
 * Lowercase, strip punctuation, tokenise, normalise homophones, then glue file+rank pairs back
 * into squares. The result contains only: piece words, `takes`, `promotes`, `castles`,
 * `short`/`long`, squares, bare files, bare ranks — plus any word we did not recognise.
 */
export function normaliseTranscript(raw: string): string[] {
  if (typeof raw !== 'string') return [];
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (cleaned.length === 0) return [];

  const expanded: string[] = [];
  for (const word of cleaned.split(' ')) {
    if (word.length > 0) expanded.push(...expandNotationToken(word));
  }

  // Map homophones, leaving the contextual 'to'/'too' for the next pass.
  const mapped = expanded.map((word) =>
    word === 'to' || word === 'too' ? word : HOMOPHONES[word] ?? word,
  );

  const out: string[] = [];
  for (let i = 0; i < mapped.length; i++) {
    const tok = mapped[i];
    if (tok === undefined) continue;

    if (tok === 'to' || tok === 'too') {
      // "d to" is d2; "rook to d1" / "promotes to queen" are prepositions.
      const prev = out[out.length - 1];
      if (prev !== undefined && FILE_RE.test(prev)) out.push('2');
      continue;
    }

    // The article in "move a knight to f3" is not an a-file origin hint.
    if (tok === 'a') {
      const next = mapped[i + 1];
      if (next !== undefined && PIECE_WORDS[next] !== undefined) continue;
    }

    if (FILLERS.has(tok)) continue;
    out.push(tok);
  }

  return mergeSquares(collapseCastleNotation(out));
}

/**
 * Turns tokens into a loose intent, or null when nothing move-like was said. An intent needs
 * either a destination square or a castling instruction — that is what makes garbage input
 * `unrecognised` instead of matching everything.
 */
export function parseIntent(tokens: string[]): MoveIntent | null {
  if (!Array.isArray(tokens) || tokens.length === 0) return null;

  if (tokens.includes(CASTLE_WORD)) {
    for (const tok of tokens) {
      if (tok === 'short' || tok === 'king') return { castle: 'short' };
      if (tok === 'long' || tok === 'queen') return { castle: 'long' };
    }
    return { castleAnySide: true };
  }

  const squareIndices: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok !== undefined && SQUARE_RE.test(tok)) squareIndices.push(i);
  }

  const destIndex = squareIndices[squareIndices.length - 1];
  if (destIndex === undefined) return null;
  const destination = tokens[destIndex];
  if (destination === undefined) return null;

  const intent: MoveIntent = { to: destination };

  // Two squares spoken ("e2 e4", "rook a1 d1"): the first is the origin.
  const originIndex = squareIndices[squareIndices.length - 2];
  if (originIndex !== undefined) {
    const origin = tokens[originIndex];
    if (origin !== undefined) {
      intent.fromFile = origin.charAt(0);
      intent.fromRank = origin.charAt(1);
    }
  }

  // Before the destination: the moving piece, capture flag and origin hints ("rook a d1").
  for (let i = 0; i < destIndex; i++) {
    const tok = tokens[i];
    if (tok === undefined || SQUARE_RE.test(tok)) continue;
    const piece = PIECE_WORDS[tok];
    if (piece !== undefined) {
      intent.piece = piece;
      continue;
    }
    if (tok === 'takes') {
      intent.capture = true;
      continue;
    }
    if (FILE_RE.test(tok)) {
      intent.fromFile = tok;
      continue;
    }
    if (RANK_RE.test(tok)) intent.fromRank = tok;
  }

  // After the destination: the promotion piece ("e8 queen", "e8 promotes to queen").
  for (let i = destIndex + 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined) continue;
    const promotion = PROMOTION_WORDS[tok];
    if (promotion !== undefined) {
      intent.promotion = promotion;
      continue;
    }
    if (tok === 'takes') intent.capture = true;
  }

  return intent;
}

/** True when `move` satisfies every constraint the speaker actually expressed. */
function matchesIntent(move: LegalMove, intent: MoveIntent): boolean {
  if (intent.castleAnySide === true) {
    return move.isKingsideCastle || move.isQueensideCastle;
  }
  if (intent.castle === 'short') return move.isKingsideCastle;
  if (intent.castle === 'long') return move.isQueensideCastle;

  if (intent.piece !== undefined && move.piece !== intent.piece) return false;
  if (intent.to !== undefined && move.to !== intent.to) return false;
  if (intent.fromFile !== undefined && move.from.charAt(0) !== intent.fromFile) return false;
  if (intent.fromRank !== undefined && move.from.charAt(1) !== intent.fromRank) return false;
  // `capture` is a positive filter only: "bishop c6" may still be a capture.
  if (intent.capture === true && !move.isCapture) return false;
  if (intent.promotion !== undefined && move.promotion !== intent.promotion) return false;
  return true;
}

/**
 * Human-readable echo the UI speaks back before applying the move ("knight f3"). Origin is
 * included only when another identical piece could reach the same square, mirroring SAN
 * disambiguation.
 */
function describeMove(move: LegalMove, legal: LegalMove[]): string {
  if (move.isKingsideCastle) return 'castles short';
  if (move.isQueensideCastle) return 'castles long';

  const parts: string[] = [];
  if (move.piece === 'p') {
    if (move.isCapture) parts.push(move.from.charAt(0), 'takes', move.to);
    else parts.push(move.to);
  } else {
    parts.push(PIECE_NAMES[move.piece]);
    const needsOrigin = legal.some(
      (other) =>
        other.piece === move.piece && other.to === move.to && other.from !== move.from,
    );
    if (needsOrigin) parts.push(move.from);
    if (move.isCapture) parts.push('takes');
    parts.push(move.to);
  }
  if (move.promotion !== undefined) {
    parts.push('promotes', 'to', PIECE_NAMES[move.promotion]);
  }
  return parts.join(' ');
}

/**
 * Last-resort tiebreak for a bare destination like "d4" that a pawn *and* a piece can reach:
 * chess convention is that an unqualified square means the pawn move, so prefer it rather than
 * asking "which one". Only applies when the speaker named no piece and exactly one pawn move
 * survives — two pawn captures onto the same square, or an unnamed promotion piece, stay
 * genuinely ambiguous.
 */
function preferPawn(survivors: LegalMove[], intent: MoveIntent): LegalMove | undefined {
  if (intent.piece !== undefined) return undefined;
  const pawnMoves = survivors.filter((move) => move.piece === 'p');
  return pawnMoves.length === 1 ? pawnMoves[0] : undefined;
}

/**
 * Tries each transcript alternative in confidence order; the first one that narrows the legal
 * move list to exactly one move wins.
 *
 * Failure modes are distinct on purpose:
 *  - a legal-sounding but illegal move (zero survivors) and unparseable garbage are both
 *    `unrecognised`;
 *  - a phrase that matches several legal moves is `ambiguous`, carrying the candidate SANs.
 *
 * A later alternative that resolves cleanly always beats an earlier ambiguous one; only once no
 * alternative resolves outright is the pawn preference applied to the highest-confidence
 * ambiguity — an explicit "knight h3" further down the list must still beat a preferred "h3".
 * When even that leaves several candidates, the ambiguity is what gets reported.
 */
export function resolveSpokenMove(alternatives: string[], legal: LegalMove[]): ResolveOutcome {
  let ambiguous: { survivors: LegalMove[]; intent: MoveIntent } | null = null;

  for (const alternative of alternatives) {
    const intent = parseIntent(normaliseTranscript(alternative));
    if (intent === null) continue;

    const survivors = legal.filter((move) => matchesIntent(move, intent));
    const only = survivors.length === 1 ? survivors[0] : undefined;
    if (only !== undefined) {
      return {
        status: 'resolved',
        san: only.san,
        move: only,
        spoken: describeMove(only, legal),
      };
    }
    if (survivors.length > 1 && ambiguous === null) {
      ambiguous = { survivors, intent };
    }
  }

  if (ambiguous !== null) {
    const pawn = preferPawn(ambiguous.survivors, ambiguous.intent);
    if (pawn !== undefined) {
      return {
        status: 'resolved',
        san: pawn.san,
        move: pawn,
        spoken: describeMove(pawn, legal),
      };
    }
    return { status: 'ambiguous', candidates: ambiguous.survivors.map((move) => move.san) };
  }
  return { status: 'unrecognised' };
}
