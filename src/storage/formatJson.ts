/**
 * `JSON.stringify` for files people read: anything that fits on one line stays on one line, and
 * an array that does not is *filled* — its short items packed into rows up to `WIDTH` columns,
 * the long ones expanded on their own rows. A stored move tree (`treeFormat.ts`) thus reads like
 * a score sheet, with only long variations indented, instead of one move per line.
 *
 * Output is plain JSON (`JSON.parse` gives back the same value) and deterministic, so files
 * written by it diff cleanly. `undefined` object fields are dropped, as `JSON.stringify` does.
 */

const WIDTH = 100;
const INDENT = '  ';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entries(value: Record<string, unknown>): [string, unknown][] {
  return Object.entries(value).filter(([, v]) => v !== undefined);
}

/** One-line JSON with a space after `,` and `:`. */
function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (isObject(value)) {
    return `{${entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** `value` starting `used` columns into a row indented by `indent`; a trailing `,` is assumed. */
function block(value: unknown, indent: string, used: number): string {
  const flat = inline(value);
  if (used + flat.length + 1 <= WIDTH || (!Array.isArray(value) && !isObject(value))) return flat;
  const inner = indent + INDENT;

  if (isObject(value)) {
    const rows = entries(value).map(([k, v]) => {
      const key = `${JSON.stringify(k)}: `;
      return key + block(v, inner, inner.length + key.length);
    });
    return `{\n${rows.map((row) => inner + row).join(',\n')}\n${indent}}`;
  }

  const rows: string[] = [];
  let row = '';
  for (const item of value) {
    const text = inline(item);
    if (inner.length + text.length + 1 > WIDTH) {
      if (row.length > 0) rows.push(row);
      row = '';
      rows.push(block(item, inner, inner.length));
      continue;
    }
    if (row.length > 0 && inner.length + row.length + 2 + text.length + 1 > WIDTH) {
      rows.push(row);
      row = '';
    }
    row = row.length > 0 ? `${row}, ${text}` : text;
  }
  if (row.length > 0) rows.push(row);
  return `[\n${rows.map((r) => inner + r).join(',\n')}\n${indent}]`;
}

/** `value` as readable JSON, newline-terminated. */
export function formatJson(value: unknown): string {
  return `${block(value, '', 0)}\n`;
}
