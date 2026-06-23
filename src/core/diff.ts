/**
 * A tiny, dependency-free line diff for configuration text.
 *
 * Built for RouterOS `/export` output, which is line-oriented (one rule or
 * setting per line) — so a line-level LCS diff produces exactly the right
 * "what changed between two snapshots" view. The output mirrors a unified diff
 * (`@@` hunk headers, ` `/`-`/`+` line prefixes) so it renders cleanly in a
 * terminal or a side-by-side dashboard view.
 *
 * This module is intentionally pure (no Bun/SQLite/device deps) so it is unit
 * tested directly under the Node/Vitest runner.
 */

/** A single line-level edit in the diff stream, in original order. */
export interface DiffOp {
  type: "eq" | "add" | "del";
  text: string;
  /** 1-based line number in the "from" text (present for `eq`/`del`). */
  aLine?: number;
  /** 1-based line number in the "to" text (present for `eq`/`add`). */
  bLine?: number;
}

export interface DiffSummary {
  added: number;
  removed: number;
  unchanged: number;
  /** True when the two inputs differ at all. */
  changed: boolean;
}

export interface DiffResult {
  summary: DiffSummary;
  ops: DiffOp[];
  /** Unified-diff text with hunk headers and surrounding context (empty when identical). */
  unified: string;
}

export interface DiffOptions {
  /** Equal lines of context to keep around each change hunk. Default 3. */
  contextLines?: number;
  /** Label for the "from" side, used in the `--- ` header line. */
  fromLabel?: string;
  /** Label for the "to" side, used in the `+++ ` header line. */
  toLabel?: string;
}

/**
 * Guard against the O(n·m) LCS table blowing up memory on pathologically large
 * inputs. A normal RouterOS export is well under a few thousand lines, so this
 * ceiling (~2k × 2k) is only ever hit by adversarial input — in which case we
 * fall back to an order-insensitive multiset diff that still reports accurate
 * add/remove/unchanged counts.
 */
const MAX_LCS_CELLS = 4_000_000;

/** Split into lines, normalising CRLF and dropping a single trailing newline. */
function splitLines(s: string): string[] {
  if (s === "") return [];
  const norm = s.replace(/\r\n/g, "\n").replace(/\n$/, "");
  return norm.split("\n");
}

/** Produce the in-order edit script via a classic LCS dynamic program. */
function lcsOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // C[i][j] = length of the LCS of a[i:] and b[j:].
  const C: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const Ci = C[i];
    const Ci1 = C[i + 1];
    const ai = a[i];
    for (let j = m - 1; j >= 0; j--) {
      Ci[j] = ai === b[j] ? Ci1[j + 1] + 1 : Math.max(Ci1[j], Ci[j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", text: a[i], aLine: i + 1, bLine: j + 1 });
      i++;
      j++;
    } else if (C[i + 1][j] >= C[i][j + 1]) {
      ops.push({ type: "del", text: a[i], aLine: i + 1 });
      i++;
    } else {
      ops.push({ type: "add", text: b[j], bLine: j + 1 });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", text: a[i], aLine: ++i });
  while (j < m) ops.push({ type: "add", text: b[j], bLine: ++j });
  return ops;
}

/**
 * Order-insensitive fallback for oversized inputs: diff line multisets so the
 * summary counts stay correct even when we skip the (too expensive) LCS table.
 */
function multisetOps(a: string[], b: string[]): DiffOp[] {
  const remaining = new Map<string, number>();
  for (const line of a) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  const ops: DiffOp[] = [];
  let bIdx = 0;
  for (const line of b) {
    bIdx++;
    const have = remaining.get(line) ?? 0;
    if (have > 0) {
      remaining.set(line, have - 1);
      ops.push({ type: "eq", text: line, bLine: bIdx });
    } else {
      ops.push({ type: "add", text: line, bLine: bIdx });
    }
  }
  let aIdx = 0;
  for (const line of a) {
    aIdx++;
    const have = remaining.get(line) ?? 0;
    if (have > 0) {
      remaining.set(line, have - 1);
      ops.push({ type: "del", text: line, aLine: aIdx });
    }
  }
  return ops;
}

/** Render the edit script as unified-diff text with context-bounded hunks. */
function toUnified(ops: DiffOp[], context: number, fromLabel?: string, toLabel?: string): string {
  // Mark every op within `context` lines of a change for inclusion; contiguous
  // runs of included ops then become hunks (overlapping context windows merge
  // naturally).
  const include = new Array<boolean>(ops.length).fill(false);
  let anyChange = false;
  ops.forEach((op, idx) => {
    if (op.type === "eq") return;
    anyChange = true;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) {
      include[k] = true;
    }
  });
  if (!anyChange) return "";

  const lines: string[] = [];
  if (fromLabel || toLabel) {
    lines.push(`--- ${fromLabel ?? "a"}`);
    lines.push(`+++ ${toLabel ?? "b"}`);
  }

  let idx = 0;
  while (idx < ops.length) {
    if (!include[idx]) {
      idx++;
      continue;
    }
    let end = idx;
    while (end < ops.length && include[end]) end++;
    const hunk = ops.slice(idx, end);

    const aLineNums = hunk.filter((o) => o.aLine != null).map((o) => o.aLine as number);
    const bLineNums = hunk.filter((o) => o.bLine != null).map((o) => o.bLine as number);
    const aLen = aLineNums.length;
    const bLen = bLineNums.length;
    const aStart = aLen ? aLineNums[0] : 0;
    const bStart = bLen ? bLineNums[0] : 0;

    lines.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of hunk) {
      const prefix = o.type === "eq" ? " " : o.type === "del" ? "-" : "+";
      lines.push(`${prefix}${o.text}`);
    }
    idx = end;
  }
  return lines.join("\n");
}

/** Diff two blocks of text line-by-line, returning ops, a summary, and unified text. */
export function diffLines(from: string, to: string, opts: DiffOptions = {}): DiffResult {
  const a = splitLines(from);
  const b = splitLines(to);
  const context = Math.max(0, opts.contextLines ?? 3);

  const ops = a.length * b.length > MAX_LCS_CELLS ? multisetOps(a, b) : lcsOps(a, b);

  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const op of ops) {
    if (op.type === "add") added++;
    else if (op.type === "del") removed++;
    else unchanged++;
  }

  return {
    summary: { added, removed, unchanged, changed: added > 0 || removed > 0 },
    ops,
    unified: toUnified(ops, context, opts.fromLabel, opts.toLabel),
  };
}
