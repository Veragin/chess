/**
 * The Personal set's id storage — the low-level half of `personal.ts`, kept free of imports so
 * `lines.ts` can keep the set in step with its own id changes (forks, deletes) without an import
 * cycle. Everything line-aware lives in `personal.ts`, which re-exports these bound to the real
 * line store.
 *
 * Same handling as the hidden server ids in `lines.ts` (`HIDDEN_KEY`): a JSON string array under
 * one key, `localStorage` looked up lazily, every access wrapped, and an in-memory mirror that
 * keeps the session working when storage is blocked or a write is rejected. Reads never write; a
 * stale id is only dropped by the next write, which keeps just the ids in `live`.
 */

/** Ids of the lines the user picked into Personal. A JSON string array. */
export const PERSONAL_KEY = 'chess-trainer.personalLines.v1';

/**
 * Session mirror of the stored set, `null` until first read. Once filled it is what every read
 * returns, so a write that only reached memory still shows up for the rest of the session.
 */
let cache: Set<string> | null = null;

function localStore(): Storage | null {
  try {
    const store = (globalThis as { localStorage?: Storage | null }).localStorage;
    if (!store || typeof store.getItem !== 'function' || typeof store.setItem !== 'function') {
      return null;
    }
    return store;
  } catch {
    return null;
  }
}

/** The stored ids, stale ones included. Never writes, whatever it finds. */
export function readPersonalIds(): Set<string> {
  if (cache !== null) return cache;
  cache = new Set();
  const store = localStore();
  if (store === null) return cache;
  try {
    const parsed: unknown = JSON.parse(store.getItem(PERSONAL_KEY) ?? '[]');
    if (Array.isArray(parsed)) {
      for (const id of parsed) if (typeof id === 'string') cache.add(id);
    }
  } catch {
    // Unreadable record: nothing is personal, and the payload stays on disk as it is.
  }
  return cache;
}

/** Stores `ids ∩ live`. Returns false when the write only reached the in-memory mirror. */
function writePersonalIds(ids: Iterable<string>, live: ReadonlySet<string>): boolean {
  cache = new Set([...ids].filter((id) => live.has(id)));
  const store = localStore();
  if (store === null) return false;
  try {
    store.setItem(PERSONAL_KEY, JSON.stringify([...cache]));
    return true;
  } catch {
    // Quota exceeded or storage revoked: kept in memory for this session.
    return false;
  }
}

export function addPersonalIds(ids: readonly string[], live: ReadonlySet<string>): boolean {
  return writePersonalIds([...readPersonalIds(), ...ids], live);
}

export function removePersonalIds(ids: readonly string[], live: ReadonlySet<string>): boolean {
  const current = readPersonalIds();
  // Nothing to drop: leave the key alone rather than rewriting it on every delete.
  if (!ids.some((id) => current.has(id))) return true;
  const drop = new Set(ids);
  return writePersonalIds([...current].filter((id) => !drop.has(id)), live);
}

/** Swaps ids for their replacement (`from → to`) — a forked server line keeps its place. */
export function replacePersonalIds(
  replacements: ReadonlyMap<string, string>,
  live: ReadonlySet<string>,
): void {
  const current = readPersonalIds();
  if (![...replacements.keys()].some((id) => current.has(id))) return;
  writePersonalIds([...current].map((id) => replacements.get(id) ?? id), live);
}

/** Drops ids not in `live`. `ok` is false when the write only reached memory. */
export function prunePersonalIds(live: ReadonlySet<string>): { removed: number; ok: boolean } {
  const current = readPersonalIds();
  const kept = [...current].filter((id) => live.has(id));
  const removed = current.size - kept.length;
  if (removed === 0) return { removed: 0, ok: true };
  return { removed, ok: writePersonalIds(kept, live) };
}

/** Empties the set. Returns false when the key could not be removed from disk. */
export function clearPersonalIds(): boolean {
  cache = new Set();
  const store = localStore();
  if (store === null) return false;
  try {
    store.removeItem(PERSONAL_KEY);
    return true;
  } catch {
    return false;
  }
}
