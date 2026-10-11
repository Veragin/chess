/**
 * One-off (but re-runnable) migration of the bundled repertoire in `public/data/` to schema v2.
 * See `implementation-plan.md` §8 and §11.
 *
 *     npx tsx scripts/migrate-data.ts                 # rewrite public/data + duplicities.md
 *     npx tsx scripts/migrate-data.ts --dry-run       # report only, write nothing
 *     npx tsx scripts/migrate-data.ts --duplicities   # also rewrite duplicities.md when no data changed
 *     npx tsx scripts/migrate-data.ts --source <dir>  # read the input from <dir> (default public/data)
 *     npx tsx scripts/migrate-data.ts --graft         # also graft lines starting mid-game (step 4)
 *
 * The output always goes to `public/data`. `--source` lets the run start from the original v1
 * files (e.g. extracted from git) so their names, notes and timestamps are what gets joined.
 *
 * Steps:
 *  1. Load every `<source>/*.json` through `migrate()` (v1 → v2 shape). Any refused line, or
 *     any move that does not replay, aborts the run before anything is written.
 *  2. Re-file lines of mixed files into the file/folder of their opening (`REFILE` below).
 *  3. Join lines sharing `joinKey` (target file, folder, start position, trained side and the
 *     first `SHARED_PLIES` moves) into one tree (`mergeTrees`). A source line's `notes` become
 *     the comment of its last move, so nothing is lost.
 *  4. Graft (only with `--graft`): a joined line whose start position is reached inside another
 *     joined line of the same target file and trained side is merged into that line at the first
 *     node (depth-first, main line first) reaching it. Repeated until nothing changes.
 *  5. Name each line `<Opening Name> - <first 5 moves>` (` (2)`, ` (3)`… on clashes).
 *  6. Write the current schema through `serialiseLinesFile` (PGN-like stored tree, compact
 *     layout); ids are derived from the join key, so re-running on its own output reproduces
 *     the same files byte for byte.
 *  7. Write `public/seed-aliases.json`: for each output line, the seed keys (`file::id`) of the
 *     lines it replaces. The app's seeder (`src/storage/seed.ts`) uses it so a user who was
 *     seeded from the old files is not given every rewritten line a second time. Entries from
 *     earlier runs are kept, so chains across several runs still resolve.
 *
 * Before anything is written, the output is checked: it loads through `migrate()` without
 * refusals, every tree replays, and every source line's moves are still a path in some output
 * line — from its root, or from a node reaching the source's start position (a grafted line).
 * `duplicities.md` (trained-side positions with more than one repertoire move) is regenerated
 * from the same data.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  branchesOf,
  branchMoves,
  countBranches,
  dedupeSiblings,
  mergeTrees,
  nodeAt,
  pathSans,
  replayTree,
  setComment,
  type MoveNode,
  type MoveTree,
} from '../src/chess/tree';
import {
  LINES_SCHEMA_VERSION,
  migrate,
  serialiseLinesFile,
  type Line,
  type LinesFile,
} from '../src/storage/schema';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'public', 'data');

/** `--source <dir>`, resolved against the working directory; `public/data` by default. */
function sourceDir(): string {
  const at = process.argv.indexOf('--source');
  if (at === -1) return DATA_DIR;
  const dir = process.argv[at + 1];
  if (dir === undefined || dir.startsWith('--')) fail('--source needs a directory');
  return resolve(dir);
}
const DUPLICITIES_FILE = join(ROOT, 'duplicities.md');
/** Outside `public/data`: everything in there is seeded as a lines file. */
const ALIASES_FILE = join(ROOT, 'public', 'seed-aliases.json');

/** Plies of the main line that identify a joined line (and appear in its name). */
const JOIN_PLIES = 5;

/** Opening moves (plies) lines must share, besides the start position, to be joined. */
const SHARED_PLIES = 3;

/* ------------------------------------------------------------------------------------- *
 * Re-filing
 * ------------------------------------------------------------------------------------- */

interface Target {
  file: string;
  folder: string;
}

interface RefileRule extends Target {
  match: (name: string) => boolean;
}

const prefix =
  (p: string) =>
  (name: string): boolean =>
    name.trim().toLowerCase().startsWith(p.toLowerCase());
const exactly =
  (n: string) =>
  (name: string): boolean =>
    name.trim().toLowerCase() === n.toLowerCase();

/**
 * Files that mix openings, and where each of their lines belongs (§8 table). A line of such a
 * file that no rule matches aborts the run. Lines of every other file stay where they are.
 * Rules also match the joined names this script writes, so a re-run leaves everything in place.
 */
const REFILE: Record<string, RefileRule[]> = {
  'Petroff-defense.json': [
    { match: prefix('Stafford'), file: 'Stafford.json', folder: 'Stafford' },
    { match: prefix('Traxler'), file: 'Traxler.json', folder: 'Traxler' },
    { match: prefix('Petroff'), file: 'Petroff-defense.json', folder: 'Petroff defense' },
    { match: exactly('Anti london'), file: 'AntiLondon.json', folder: 'Anti-london' },
    { match: exactly('e4 D4 push'), file: 'Center-game.json', folder: 'Center Game' },
    { match: exactly('Trap f4'), file: 'From-gambit.json', folder: 'From gambit' },
    { match: exactly('D4 start'), file: 'Budapest.json', folder: 'Budapest' },
  ],
};

/** The opening a folder stands for: the folder path with `/` → space. */
function openingName(folder: string, file: string): string {
  const name = folder.split('/').join(' ').trim();
  return name.length > 0 ? name : basename(file, '.json');
}

/* ------------------------------------------------------------------------------------- *
 * Loading
 * ------------------------------------------------------------------------------------- */

/** One input line, replayed and placed. */
interface Source {
  file: string;
  exportedAt: number;
  line: Line;
  /** SAN-normalised by chess.js, duplicate siblings merged. */
  tree: MoveTree;
  /** Start position as chess.js writes it, without the move counters. */
  fenKey: string;
  target: Target;
  opening: string;
  /** Position of the line in its file, for a stable order. */
  index: number;
}

/** Placement, side, castling, en passant — the part of a FEN that makes a position. */
function fenKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(' ');
}

function fail(message: string): never {
  console.error(`migrate-data: ${message}`);
  process.exit(1);
}

function loadFile(dir: string, file: string): LinesFile {
  const result = migrate(readFileSync(join(dir, file), 'utf8'));
  if (result.error !== undefined) fail(`${file}: ${result.error}`);
  return result.file;
}

function loadSources(dir: string, files: string[]): Source[] {
  const sources: Source[] = [];
  for (const file of files) {
    const { exportedAt, lines } = loadFile(dir, file);
    lines.forEach((line, index) => {
      const replay = replayTree(line.startFen, line.tree);
      if (replay.broken !== null || replay.startFen === null) {
        fail(`${file}: "${line.name}": ${replay.broken?.reason ?? 'does not replay'}`);
      }
      const rules = REFILE[file];
      let target: Target = { file, folder: line.folder ?? '' };
      if (rules !== undefined) {
        const rule = rules.find((r) => r.match(line.name));
        if (rule === undefined) fail(`${file}: no re-filing rule matches "${line.name}"`);
        target = { file: rule.file, folder: rule.folder };
      }
      sources.push({
        file,
        exportedAt,
        line,
        tree: dedupeSiblings(replay.tree),
        fenKey: fenKey(replay.startFen),
        target,
        opening: openingName(target.folder, target.file),
        index,
      });
    });
  }
  return sources;
}

/* ------------------------------------------------------------------------------------- *
 * Joining
 * ------------------------------------------------------------------------------------- */

/** The first `JOIN_PLIES` moves of the main line (all of them for a shorter line). */
function leadingMoves(tree: MoveTree, plies = JOIN_PLIES): string[] {
  return branchMoves(tree, branchesOf(tree)[0] ?? []).slice(0, plies);
}

/**
 * The one definition of "these lines start together": same target file and folder, same start
 * position, same trained side, same first `SHARED_PLIES` moves of the main line (all of them for
 * a shorter line). Lines starting elsewhere are only joined by grafting (`graftAll`, `--graft`).
 */
function joinKey(source: Source): string {
  const moves = leadingMoves(source.tree, SHARED_PLIES).join(' ');
  return [source.target.file, source.target.folder, source.fenKey, source.line.userColor, moves].join('|');
}

/**
 * The source's tree with its `notes` attached to its last move — they describe that branch. A
 * source that already branches (a re-run on v2 data) has no single last move: its notes stay
 * line-level, as they do for a line without moves.
 */
function treeWithNotes(source: Source): { tree: MoveTree; notes: string | null } {
  const notes = source.line.notes?.trim() ?? '';
  if (notes.length === 0) return { tree: source.tree, notes: null };
  if (source.tree.length === 0 || countBranches(source.tree) > 1) {
    return { tree: source.tree, notes };
  }
  const leaf = branchesOf(source.tree)[0] as number[];
  let node: MoveNode | undefined;
  let children = source.tree;
  for (const step of leaf) {
    node = children[step];
    children = node?.next ?? [];
  }
  const existing = node?.comment;
  const comment = existing === undefined || existing === notes ? notes : `${existing}\n${notes}`;
  return { tree: setComment(source.tree, leaf, comment), notes: null };
}

/** A joined line grafted into another one. */
interface Graft {
  /** The grafted group (its own key and first source name identify it in the report). */
  group: Group;
  /** The group whose tree it now lives in — updated when that one is grafted in turn. */
  root: Group;
  /** Moves from `root`'s start to the node it hangs from. */
  at: string[];
}

interface Group {
  key: string;
  target: Target;
  /** Start position, first four FEN fields. */
  startKey: string;
  /** Every source line in the tree, grafted ones included, in join order. */
  members: Source[];
  line: Line;
}

/** A stable UUID-shaped id derived from the join key, so a re-run writes the same ids. */
function stableId(key: string): string {
  const hex = createHash('sha1').update(`chess-trainer/public-data/${key}`).digest('hex');
  const variant = ((parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function addNotes(line: Line, notes: string): void {
  if (line.notes === undefined) line.notes = notes;
  else if (!`\n${line.notes}\n`.includes(`\n${notes}\n`)) line.notes = `${line.notes}\n${notes}`;
}

function joinGroup(key: string, members: Source[]): Group {
  const first = members[0] as Source;
  let tree: MoveTree = [];
  const line: Line = {
    id: stableId(key),
    name: '', // set by `nameGroups`, which sees every group
    startFen: first.line.startFen,
    tree,
    userColor: first.line.userColor,
    createdAt: Math.min(...members.map((m) => m.line.createdAt)),
    updatedAt: Math.max(...members.map((m) => m.line.updatedAt)),
  };
  for (const member of members) {
    const part = treeWithNotes(member);
    tree = mergeTrees(tree, part.tree);
    if (part.notes !== null) addNotes(line, part.notes);
  }
  line.tree = tree;
  if (first.target.folder.length > 0) line.folder = first.target.folder;
  return { key, target: first.target, startKey: first.fenKey, members: [...members], line };
}

/** `tree` with `sub` merged into the children of the node at `path`. */
function graftAt(tree: MoveTree, path: number[], sub: MoveTree): MoveTree {
  const [step, ...rest] = path;
  return tree.map((node, i) =>
    i !== step
      ? node
      : { ...node, next: rest.length > 0 ? graftAt(node.next, rest, sub) : mergeTrees(node.next, sub) },
  );
}

/** First node (depth-first, main line first) of `line` after which the position is `startKey`. */
function nodeReaching(line: Line, startKey: string): number[] | null {
  const node = replayTree(line.startFen, line.tree).nodes.find((n) => fenKey(n.fenAfter) === startKey);
  return node === undefined ? null : node.path;
}

/**
 * Grafts every group whose start position is reached inside another group of the same target
 * file and trained side into that group's tree (the host keeps its folder, and its moves stay
 * first). The earliest group that can be grafted goes first, into the earliest host reaching its
 * start, then the scan restarts — so chains collapse into one tree, a group is never grafted
 * into itself (no cycles), and the result depends only on the group order.
 */
function graftAll(groups: Group[]): { roots: Group[]; grafts: Graft[] } {
  const roots = [...groups];
  const grafts: Graft[] = [];
  for (;;) {
    let done: { group: Group; host: Group; path: number[] } | null = null;
    for (const group of roots) {
      for (const host of roots) {
        if (host === group || host.target.file !== group.target.file) continue;
        if (host.line.userColor !== group.line.userColor) continue;
        const path = nodeReaching(host.line, group.startKey);
        if (path !== null) {
          done = { group, host, path };
          break;
        }
      }
      if (done !== null) break;
    }
    if (done === null) return { roots, grafts };

    const { group, host, path } = done;
    const at = pathSans(host.line.tree, path);
    host.line.tree = graftAt(host.line.tree, path, group.line.tree);
    if (group.line.notes !== undefined) addNotes(host.line, group.line.notes);
    host.line.createdAt = Math.min(host.line.createdAt, group.line.createdAt);
    host.line.updatedAt = Math.max(host.line.updatedAt, group.line.updatedAt);
    host.members.push(...group.members);
    for (const g of grafts) {
      if (g.root === group) {
        g.root = host;
        g.at = [...at, ...g.at];
      }
    }
    grafts.push({ group, root: host, at });
    roots.splice(roots.indexOf(group), 1);
  }
}

/** `<Opening Name> - <first 5 moves>`, suffixed ` (2)`, ` (3)`… when a name is already taken. */
function nameGroups(groups: Group[]): void {
  const taken = new Set<string>();
  for (const group of groups) {
    const first = group.members[0] as Source;
    const moves = leadingMoves(group.line.tree).join(' ');
    const base = moves.length > 0 ? `${first.opening} - ${moves}` : first.opening;
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
    taken.add(name);
    group.line.name = name;
  }
}

/**
 * Lines in output order: per target file, the file's own lines first (so they stay the main
 * line of a merged tree), then lines re-filed into it; source order within each.
 */
function joinAll(sources: Source[]): { groups: Group[]; grafts: Graft[] } {
  const ordered = [...sources].sort(
    (a, b) =>
      a.target.file.localeCompare(b.target.file) ||
      Number(a.file !== a.target.file) - Number(b.file !== b.target.file) ||
      a.file.localeCompare(b.file) ||
      a.index - b.index,
  );
  const byKey = new Map<string, Source[]>();
  for (const source of ordered) {
    const key = joinKey(source);
    const members = byKey.get(key);
    if (members === undefined) byKey.set(key, [source]);
    else members.push(source);
  }
  const joined = [...byKey].map(([key, members]) => joinGroup(key, members));
  const { roots, grafts } = process.argv.includes('--graft')
    ? graftAll(joined)
    : { roots: joined, grafts: [] };
  nameGroups(roots);
  return { groups: roots, grafts };
}

/* ------------------------------------------------------------------------------------- *
 * Writing
 * ------------------------------------------------------------------------------------- */

function outputFiles(groups: Group[]): Map<string, LinesFile> {
  const files = new Map<string, LinesFile>();
  for (const group of groups) {
    const file = (group.members[0] as Source).target.file;
    const out = files.get(file) ?? { schemaVersion: LINES_SCHEMA_VERSION, exportedAt: 0, lines: [] };
    out.exportedAt = Math.max(out.exportedAt, ...group.members.map((m) => m.exportedAt));
    out.lines.push(group.line);
    files.set(file, out);
  }
  return files;
}

function writeIfChanged(path: string, text: string, dryRun: boolean): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;
  if (!dryRun) writeFileSync(path, text);
  return true;
}

/** The key `src/storage/seed.ts` records for a bundled line. */
const seedKey = (file: string, line: Line): string => `${file}::${line.id}`;

function readAliases(): Record<string, string[]> {
  if (!existsSync(ALIASES_FILE)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(ALIASES_FILE, 'utf8'));
  } catch (err) {
    fail(`${basename(ALIASES_FILE)}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(`${basename(ALIASES_FILE)}: expected an object`);
  }
  return parsed as Record<string, string[]>;
}

/**
 * Each output line's key → the keys of the source lines now inside it (itself excluded). Earlier
 * entries are kept: a source that was itself an output of an earlier run is only listed by its
 * own key, and the seeder follows the chain from there.
 */
function seedAliases(groups: Group[], existing: Record<string, string[]>): Record<string, string[]> {
  const aliases: Record<string, string[]> = { ...existing };
  for (const group of groups) {
    const key = seedKey(group.target.file, group.line);
    const previous = [...new Set(group.members.map((m) => seedKey(m.file, m.line)))]
      .filter((k) => k !== key)
      .sort();
    if (previous.length > 0) aliases[key] = previous;
  }
  return Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b)));
}

/* ------------------------------------------------------------------------------------- *
 * Report
 * ------------------------------------------------------------------------------------- */

const quote = (s: string): string => `"${s}"`;
const movesText = (sans: string[]): string => (sans.length > 0 ? sans.join(' ') : '(start)');

/** The source lines a group was joined from, for the report: first name and how many more. */
function groupLabel(group: Group, ownOnly: boolean): string {
  const members = ownOnly ? group.members.filter((m) => joinKey(m) === group.key) : group.members;
  const first = members[0] as Source;
  const more = members.length > 1 ? ` +${members.length - 1}` : '';
  return `${quote(first.line.name)}${more}`;
}

/**
 * Why a line stayed separate from the other lines of its file: its start position is reached
 * nowhere else in the file with the same trained side (maybe in a line training the other side,
 * or in another file — neither is ever joined).
 */
function unmergedReasons(groups: Group[]): string[] {
  const out: string[] = [];
  const reaching = (pool: Group[], group: Group): string | null => {
    for (const g of pool) {
      const path = nodeReaching(g.line, group.startKey);
      if (path !== null) return `${quote(g.line.name)} after ${movesText(pathSans(g.line.tree, path))}`;
    }
    return null;
  };
  for (const group of groups) {
    const others = groups.filter((g) => g !== group && g.target.file === group.target.file);
    if (others.length === 0) continue;
    const sameSide = others.filter((g) => g.line.userColor === group.line.userColor);
    const sameStart = sameSide.filter((g) => g.startKey === group.startKey);
    const sameFolder = sameStart.filter((g) => g.target.folder === group.target.folder);
    const otherFolder = sameStart.filter((g) => g.target.folder !== group.target.folder);
    const why: string[] = [];
    if (sameFolder.length > 0) {
      why.push(
        `same start as ${sameFolder.map((g) => quote(g.line.name)).join(', ')} but other first ${SHARED_PLIES} moves`,
      );
    }
    if (otherFolder.length > 0) {
      why.push(`same start as ${otherFolder.map((g) => quote(g.line.name)).join(', ')} but another folder`);
    }
    if (sameStart.length === 0) {
      why.push(`start position not reached in any other line of ${group.target.file} training the same side`);
    }
    const otherSide = reaching(
      others.filter((g) => g.line.userColor !== group.line.userColor),
      group,
    );
    if (otherSide !== null) why.push(`reached in ${otherSide}, which trains the other side`);
    const otherFile = reaching(
      groups.filter((g) => g.target.file !== group.target.file && g.line.userColor === group.line.userColor),
      group,
    );
    if (otherFile !== null) why.push(`reached in another file: ${otherFile}`);
    out.push(`  ${group.target.file}: ${quote(group.line.name)} — ${why.join('; ')}  [${group.startKey}]`);
  }
  return out;
}

function printReport(
  sourceDirectory: string,
  inputFiles: string[],
  sources: Source[],
  files: Map<string, LinesFile>,
  groups: Group[],
  grafts: Graft[],
): void {
  if (sourceDirectory !== DATA_DIR) console.log(`source: ${sourceDirectory}\n`);
  const names = [...new Set([...inputFiles, ...files.keys()])].sort();
  const rows = names.map((file) => {
    const own = sources.filter((s) => s.file === file);
    return {
      file,
      in: own.length,
      movedOut: own.filter((s) => s.target.file !== file).length,
      movedIn: sources.filter((s) => s.target.file === file && s.file !== file).length,
      out: files.get(file)?.lines.length ?? 0,
    };
  });
  const width = Math.max(...names.map((n) => n.length));
  console.log(`${'file'.padEnd(width)}   in  →  out   (re-filed out / in)`);
  for (const r of rows) {
    const moved = r.movedOut + r.movedIn > 0 ? `   (-${r.movedOut} / +${r.movedIn})` : '';
    console.log(`${r.file.padEnd(width)} ${String(r.in).padStart(4)}  → ${String(r.out).padStart(4)}${moved}`);
  }
  const totalIn = rows.reduce((s, r) => s + r.in, 0);
  const totalOut = rows.reduce((s, r) => s + r.out, 0);
  console.log(`${'total'.padEnd(width)} ${String(totalIn).padStart(4)}  → ${String(totalOut).padStart(4)}`);

  console.log('\noutput lines (branches, source lines):');
  for (const group of groups) {
    console.log(
      `  ${group.target.file}: ${quote(group.line.name)} — ${countBranches(group.line.tree)} branches, ` +
        `${group.members.length} source lines`,
    );
  }

  const refiled = sources.filter((s) => s.target.file !== s.file || REFILE[s.file] !== undefined);
  if (refiled.length > 0) {
    console.log('\nre-filed:');
    for (const s of refiled) {
      console.log(`  ${s.file}: ${quote(s.line.name)} → ${s.target.file} [${s.target.folder}]`);
    }
  }

  if (grafts.length > 0) {
    console.log('\ngrafted (joined line → line it now lives in, after the moves from that line\'s start):');
    for (const g of grafts) {
      console.log(
        `  ${g.group.target.file}: ${groupLabel(g.group, true)} → ${quote(g.root.line.name)} after ${movesText(g.at)}`,
      );
    }
  }

  const unmerged = unmergedReasons(groups);
  if (unmerged.length > 0) {
    console.log('\nnot merged:');
    for (const u of unmerged) console.log(u);
  }
}

/* ------------------------------------------------------------------------------------- *
 * Duplicities: positions where the repertoire gives the trained side several moves, matched
 * across all files
 * ------------------------------------------------------------------------------------- */

interface Use {
  source: Source;
  joined: Group;
}

interface Duplicity {
  /** Openings whose lines reach the position, in discovery order (positions match across files). */
  openings: string[];
  fen: string;
  example: { moves: string[]; source: Source };
  /** Move → the (source line, joined line) pairs playing it, in discovery order. */
  moves: Map<string, Use[]>;
  /** Nodes (or the start) of a joined line where its tree branches on these moves. */
  branches: { joined: Group; at: string[]; moves: string[] }[];
}

function findDuplicities(groups: Group[]): Duplicity[] {
  const rootOf = new Map<Source, Group>();
  for (const group of groups) for (const m of group.members) rootOf.set(m, group);

  const positions = new Map<string, Duplicity>();
  const keyOf = (color: string, fen: string): string => `${color}|${fen}`;
  for (const group of groups) {
    for (const source of group.members) {
      for (const node of replayTree(source.line.startFen, source.tree).nodes) {
        if (node.fenBefore.split(' ')[1] !== source.line.userColor) continue;
        const fen = fenKey(node.fenBefore);
        const key = keyOf(source.line.userColor, fen);
        let entry = positions.get(key);
        if (entry === undefined) {
          const moves = pathSans(source.tree, node.path.slice(0, -1));
          entry = { openings: [], fen, example: { moves, source }, moves: new Map(), branches: [] };
          positions.set(key, entry);
        }
        if (!entry.openings.includes(source.opening)) entry.openings.push(source.opening);
        const users = entry.moves.get(node.san) ?? [];
        if (!users.some((u) => u.source === source)) users.push({ source, joined: rootOf.get(source) as Group });
        entry.moves.set(node.san, users);
      }
    }
  }

  // Where a joined tree itself branches on the trained side — what drill meets (D6).
  for (const group of groups) {
    const { line } = group;
    const record = (fen: string, children: MoveNode[], path: number[]): void => {
      if (fen.split(' ')[1] !== line.userColor || children.length < 2) return;
      const entry = positions.get(keyOf(line.userColor, fenKey(fen)));
      entry?.branches.push({ joined: group, at: pathSans(line.tree, path), moves: children.map((c) => c.san) });
    };
    const replay = replayTree(line.startFen, line.tree);
    record(replay.startFen ?? line.startFen, line.tree, []);
    for (const node of replay.nodes) record(node.fenAfter, nodeAt(line.tree, node.path)?.next ?? [], node.path);
  }
  return [...positions.values()].filter((d) => d.moves.size > 1);
}

/** True when one joined line offers several of the moves (at one node or by transposition). */
function insideOneLine(d: Duplicity): boolean {
  const perLine = new Map<Group, Set<string>>();
  for (const [san, users] of d.moves) {
    for (const { joined } of users) {
      const set = perLine.get(joined) ?? new Set<string>();
      set.add(san);
      perLine.set(joined, set);
    }
  }
  return [...perLine.values()].some((set) => set.size > 1);
}

type Kind = 'branch' | 'transposition' | 'across';

function kindOf(d: Duplicity): Kind {
  if (d.branches.length > 0) return 'branch';
  return insideOneLine(d) ? 'transposition' : 'across';
}

const KIND_LABEL: Record<Kind, string> = {
  branch: 'branch inside one line',
  transposition: 'transposition inside one line',
  across: 'across lines',
};

function renderDuplicities(dups: Duplicity[]): string {
  const counts = new Map<string, number>();
  for (const d of dups) {
    const opening = d.openings.join(' / ');
    counts.set(opening, (counts.get(opening) ?? 0) + 1);
  }
  const breakdown = [...counts].map(([opening, n]) => `${opening} ×${n}`).join(', ');
  const n = (kind: Kind): number => dups.filter((d) => kindOf(d) === kind).length;
  const where = `${n('branch')} branch inside a single joined line (drill accepts either move there), ${n('transposition')} inside one line by transposition, ${n('across')} across lines.`;
  const summary =
    dups.length === 0
      ? '**Summary:** none — every trained-side position has exactly one repertoire move.'
      : `**Summary:** ${dups.length} position${dups.length === 1 ? '' : 's'} (${breakdown}). ${where}`;

  const label = (s: Source): string => `\`${s.line.name}\` (${s.file})`;
  /** `source (file) → joined line`, or just the line when the source already is that line. */
  const use = ({ source, joined }: Use): string =>
    source.line.name === joined.line.name && source.file === source.target.file
      ? label(source)
      : `${label(source)} → ${joined.line.name}`;
  const out = [
    '# Trained-side duplicities in `public/data`',
    '',
    'Positions where the repertoire gives the **trained side** more than one move. Lines are joined when they share the start position and the first 3 moves, so most of these alternatives now sit *inside* one joined line, where drill accepts any of them (decision D6). Lines use the re-filing from §8 of the plan.',
    '',
    summary,
    '',
    'Usually one of them is a mistake or an unintended alternative worth reviewing. Positions are matched by transposition across all files (same trained side); each move lists the original (v1) lines playing it and the joined line they are now part of.',
    '',
    '- **branch inside one line** — the joined tree branches on a move of the trained side at this position; drill accepts any of the moves and continues on that branch (D6).',
    '- **transposition inside one line** — one joined line reaches the position at different nodes with different moves; at each node drill only knows that node\'s move.',
    '- **across lines** — different joined lines disagree; Explore shows both continuations, drill is not affected.',
    '',
    'Generated by `npx tsx scripts/migrate-data.ts`.',
  ];
  for (const d of dups) {
    const after = d.example.moves.length > 0 ? d.example.moves.join(' ') : '(start of line)';
    out.push(
      '',
      `### ${d.openings.join(' / ')} — ${KIND_LABEL[kindOf(d)]}`,
      '',
      `Position: \`${d.fen}\` (e.g. after \`${after}\` in ${label(d.example.source)})`,
      '',
    );
    for (const b of d.branches) {
      const at = b.at.length > 0 ? `after \`${b.at.join(' ')}\`` : 'at its start';
      out.push(`Branches in \`${b.joined.line.name}\` ${at}: ${b.moves.map((m) => `**${m}**`).join(', ')}`, '');
    }
    for (const [san, users] of d.moves) {
      out.push(`- **${san}** — ${[...new Set(users.map(use))].join('; ')}`);
    }
  }
  return `${out.join('\n')}\n`;
}

/* ------------------------------------------------------------------------------------- *
 * Verification of what was written
 * ------------------------------------------------------------------------------------- */

/** True when `sans` can be walked from `children` (a whole branch or a prefix of one). */
function hasPath(children: MoveTree, sans: string[]): boolean {
  let level = children;
  for (const san of sans) {
    const node = level.find((c) => c.san === san);
    if (node === undefined) return false;
    level = node.next;
  }
  return true;
}

interface Written {
  file: string;
  line: Line;
  /** Position key → the children lists a source starting there may continue in. */
  starts: Map<string, MoveTree[]>;
}

/** Checks the serialised output (`texts`, by file) before any of it reaches the disk. */
function verify(
  files: Map<string, LinesFile>,
  texts: Map<string, string>,
  sources: Source[],
): string[] {
  const problems: string[] = [];
  const written: Written[] = [];
  for (const [file, expected] of files) {
    const result = migrate(texts.get(file));
    if (result.error !== undefined) problems.push(`${file}: ${result.error}`);
    if (result.changed) problems.push(`${file}: migrate() reports changes on read`);
    if (result.file.lines.length !== expected.lines.length) {
      problems.push(`${file}: ${result.file.lines.length} of ${expected.lines.length} lines load`);
    }
    for (const line of result.file.lines) {
      const replay = replayTree(line.startFen, line.tree);
      if (replay.broken !== null || replay.startFen === null) {
        problems.push(`${file}: "${line.name}": ${replay.broken?.reason ?? 'does not replay'}`);
        continue;
      }
      const starts = new Map<string, MoveTree[]>([[fenKey(replay.startFen), [line.tree]]]);
      for (const node of replay.nodes) {
        const key = fenKey(node.fenAfter);
        starts.set(key, [...(starts.get(key) ?? []), nodeAt(line.tree, node.path)?.next ?? []]);
      }
      written.push({ file, line, starts });
    }
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  for (const { file, line } of written) {
    if (ids.has(line.id)) problems.push(`${file}: duplicate id ${line.id}`);
    if (names.has(line.name)) problems.push(`${file}: duplicate name "${line.name}"`);
    ids.add(line.id);
    names.add(line.name);
  }

  for (const source of sources) {
    const candidates = written.filter(
      (w) =>
        w.file === source.target.file &&
        w.line.userColor === source.line.userColor &&
        w.starts.has(source.fenKey),
    );
    for (const branch of branchesOf(source.tree)) {
      const sans = branchMoves(source.tree, branch);
      const found = candidates.some((c) =>
        (c.starts.get(source.fenKey) as MoveTree[]).some((children) => hasPath(children, sans)),
      );
      if (!found) {
        problems.push(`${source.file}: "${source.line.name}" [${sans.join(' ')}] is in no output line`);
      }
    }
    const notes = source.line.notes?.trim() ?? '';
    if (notes.length > 0) {
      const kept = candidates.some((c) => JSON.stringify(c.line).includes(JSON.stringify(notes).slice(1, -1)));
      if (!kept) problems.push(`${source.file}: notes of "${source.line.name}" were lost`);
    }
  }
  return problems;
}

/* ------------------------------------------------------------------------------------- *
 * Main
 * ------------------------------------------------------------------------------------- */

const jsonFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const source = sourceDir();
  const inputFiles = jsonFiles(source);
  const sources = loadSources(source, inputFiles);
  const { groups, grafts } = joinAll(sources);
  const files = outputFiles(groups);
  const texts = new Map([...files].map(([file, content]) => [file, serialiseLinesFile(content, true)]));
  const aliases = seedAliases(groups, readAliases());

  // Everything below writes, so the output is checked first: a failed check leaves the disk as
  // it was.
  const problems = verify(files, texts, sources);
  if (problems.length > 0) {
    printReport(source, inputFiles, sources, files, groups, grafts);
    console.error(`\nverification FAILED (${problems.length}), nothing written:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }

  const changed: string[] = [];
  for (const [file, text] of texts) {
    if (writeIfChanged(join(DATA_DIR, file), text, dryRun)) changed.push(file);
  }
  const untouched: string[] = [];
  for (const file of jsonFiles(DATA_DIR)) {
    if (files.has(file)) continue;
    // An input file whose lines all went elsewhere: remove it. Any other file in public/data is
    // not part of this run (a different --source), so it is left alone and reported.
    if (!inputFiles.includes(file)) {
      untouched.push(file);
      continue;
    }
    if (!dryRun) unlinkSync(join(DATA_DIR, file));
    changed.push(`${file} (removed: no lines left)`);
  }
  if (writeIfChanged(ALIASES_FILE, `${JSON.stringify(aliases, null, 2)}\n`, dryRun)) {
    changed.push(basename(ALIASES_FILE));
  }
  // Regenerated when the data changes (§11) or on request. A re-run on already-migrated data
  // would only lose the original line names the report names as sources.
  const dups = findDuplicities(groups);
  const regenerate = changed.length > 0 || process.argv.includes('--duplicities');
  if (regenerate && writeIfChanged(DUPLICITIES_FILE, renderDuplicities(dups), dryRun)) {
    changed.push(basename(DUPLICITIES_FILE));
  }

  printReport(source, inputFiles, sources, files, groups, grafts);
  const kinds = (kind: Kind): number => dups.filter((d) => kindOf(d) === kind).length;
  console.log(
    `\nduplicities: ${dups.length} trained-side position(s): ${kinds('branch')} branch inside one line, ` +
      `${kinds('transposition')} by transposition inside one line, ${kinds('across')} across lines`,
  );
  for (const d of dups.filter((x) => kindOf(x) === 'branch')) {
    for (const b of d.branches) {
      console.log(`  ${quote(b.joined.line.name)} after ${movesText(b.at)}: ${b.moves.join(' / ')}`);
    }
  }
  if (untouched.length > 0) {
    console.log(`\nnot part of this run, left untouched in public/data: ${untouched.join(', ')}`);
  }
  console.log(
    changed.length > 0
      ? `\n${dryRun ? 'would change' : 'changed'}: ${changed.join(', ')}`
      : '\nnothing to change',
  );
  console.log(
    `verified: ${files.size} files load through migrate(), every tree replays, ` +
      `every source line is a path of an output line (from its root or from its start position)`,
  );
}

main();
