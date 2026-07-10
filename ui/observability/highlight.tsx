import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ── JSON syntax highlighter ──────────────────────────────────────────────────
// Tokenises pretty-printed JSON into coloured spans (keys / strings / numbers /
// booleans / null). Dependency-free and XSS-safe — React escapes every token's
// text. Non-JSON input degrades gracefully (only quoted strings/numbers light up).
const JSON_TOKEN =
  /("(?:\\.|[^"\\])*"(?:\s*:)?)|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Tokenise JSON text into coloured `<span>`s (plain runs stay as raw strings). */
export function highlightJson(json: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of json.matchAll(JSON_TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(json.slice(last, idx));
    const tok = m[0];
    // Semantic-token colours: keys→foreground, strings→success, numbers→chart-1,
    // booleans/null→warning (punctuation is coloured by the container).
    let cls: string;
    if (m[1] !== undefined) cls = /:\s*$/.test(tok) ? "text-foreground" : "text-success";
    else if (m[2] !== undefined) cls = "text-warning";
    else cls = "text-chart-1";
    parts.push(
      <span className={cls} key={i++}>
        {tok}
      </span>,
    );
    last = idx + tok.length;
  }
  if (last < json.length) parts.push(json.slice(last));
  return parts;
}

// Tokenises RouterOS `print`-style device OUTPUT into light, useful coloured
// spans: key=value columns, IPv4/CIDR, MAC, quoted strings, numbers, yes/no,
// status words (running/disabled/…), `;;;` comments and error phrases.
// Dependency-free and XSS-safe — React escapes every token's text; anything
// unmatched stays plain. Case-insensitive so YES/Disabled colour too.
const ROS_TOKEN = new RegExp(
  [
    /(;;;[^\n]*)/, // 1 comment (to end of line)
    /("(?:\\.|[^"\\])*")/, // 2 quoted string
    /([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})/, // 3 MAC address
    /(\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?)/, // 4 IPv4 / CIDR
    /([A-Za-z.][\w.-]*)(?==)/, // 5 key (the name before '=')
    /\b(running|enabled|active|connected|established|reachable|bound|authorized|ok|up)\b/, // 6 good status
    /\b(disabled|invalid|inactive|stopped|unreachable|timeout|failure|failed|error|rejected|expired|down)\b/, // 7 bad status
    /\b(yes|no|true|false)\b/, // 8 boolean (neutral — value, not health)
    /\b(dynamic|slave|builtin|default|passthrough|complete)\b/, // 9 dim keyword
    /(-?\d+(?:\.\d+)?)/, // 10 number
  ]
    .map((r) => r.source)
    .join("|"),
  "gi",
);

/** Tokenise RouterOS device output into coloured `<span>`s (plain runs stay raw). */
export function highlightDeviceOutput(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(ROS_TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    const tok = m[0];
    // Semantic-token colours per RouterOS group (see ROS_TOKEN order above).
    let cls = "text-chart-1"; // number
    if (m[1] !== undefined)
      cls = "text-muted-foreground italic"; // comment
    else if (m[2] !== undefined)
      cls = "text-success"; // quoted string
    else if (m[3] !== undefined)
      cls = "text-chart-5"; // MAC
    else if (m[4] !== undefined)
      cls = "text-chart-2"; // IPv4 / CIDR
    else if (m[5] !== undefined)
      cls = "text-foreground"; // key
    else if (m[6] !== undefined)
      cls = "text-success font-medium"; // good status
    else if (m[7] !== undefined)
      cls = "text-destructive font-medium"; // bad status
    else if (m[8] !== undefined)
      cls = "text-warning"; // boolean
    else if (m[9] !== undefined) cls = "text-muted-foreground"; // dim keyword
    parts.push(
      <span className={cls} key={i++}>
        {tok}
      </span>,
    );
    last = idx + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// INPUT JSON pretty-print preference — remembered across drawers and reloads.
const PRETTY_INPUT_KEY = "mt-pretty-input";

/** Read the persisted "pretty-print INPUT JSON" choice (defaults to on). */
export function loadPrettyInput(): boolean {
  try {
    return localStorage.getItem(PRETTY_INPUT_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Persist the pretty-print choice. */
export function savePrettyInput(on: boolean): void {
  try {
    localStorage.setItem(PRETTY_INPUT_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable — the choice just won't persist */
  }
}

/** Re-indent a JSON string when `pretty`; pass non-JSON through untouched. */
export function formatInputJson(raw: string, pretty: boolean): string {
  if (!pretty) return raw;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function JsonView({ value, maxHeight }: { value: unknown; maxHeight?: number }): ReactNode {
  const json = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre
      className="m-0 max-h-[40vh] overflow-auto rounded border border-border bg-background p-3 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground"
      style={maxHeight ? { maxHeight } : undefined}
    >
      {highlightJson(json)}
    </pre>
  );
}

// ── Unified JSON diff ─────────────────────────────────────────────────────────

/** The role of a unified-diff line, from its leading marker. */
type DiffKind = "add" | "del" | "ctx" | "hunk" | "file";

function diffKind(line: string): DiffKind {
  // `---`/`+++` file headers are checked before `-`/`+` so they don't read as
  // removed/added lines.
  if (line.startsWith("+++") || line.startsWith("---")) return "file";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

/** Per-line row background (the diff signal). */
const DIFF_ROW: Record<DiffKind, string> = {
  add: "bg-success/10",
  del: "bg-destructive/10",
  hunk: "bg-muted/50",
  file: "",
  ctx: "",
};

/** Gutter marker colour. */
const DIFF_GUTTER: Record<DiffKind, string> = {
  add: "text-success",
  del: "text-destructive",
  hunk: "text-brand",
  file: "text-muted-foreground",
  ctx: "text-muted-foreground/50",
};

const DIFF_MARK: Record<DiffKind, string> = { add: "+", del: "−", ctx: "", hunk: "", file: "" };

/**
 * Render a unified diff of JSON with BOTH colour dimensions: a per-line diff
 * signal (green for additions, red for removals, a muted band for hunk headers,
 * carried in the row background + a coloured gutter marker) AND the JSON syntax
 * colours from {@link highlightJson} on the line content — so keys, strings and
 * numbers still light up exactly as they do in the effective-config view.
 *
 * The diff signal lives in the gutter/background rather than the text colour, so
 * it never fights the JSON token colours: an added string is green-on-faint-green
 * with a green `+`, not a wash that hides the syntax.
 */
export function JsonDiffView({
  unified,
  maxHeight,
}: {
  unified: string;
  maxHeight?: number;
}): ReactNode {
  const lines = unified.replace(/\n+$/, "").split("\n");
  return (
    <pre
      className="text-muted-foreground m-0 overflow-auto rounded border border-border bg-background py-2 font-mono text-[11px] leading-[1.6] break-words whitespace-pre-wrap"
      style={maxHeight ? { maxHeight } : undefined}
    >
      {lines.map((line, i) => {
        const kind = diffKind(line);
        // Strip the one-char marker from add/del/context so the content is clean
        // JSON; hunk/file headers are shown whole and not syntax-highlighted.
        const structural = kind === "hunk" || kind === "file";
        const body = kind === "add" || kind === "del" || kind === "ctx" ? line.slice(1) : line;
        return (
          <div key={i} className={cn("flex px-2", DIFF_ROW[kind])}>
            <span className={cn("w-3 shrink-0 select-none text-center", DIFF_GUTTER[kind])}>
              {DIFF_MARK[kind]}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 break-words whitespace-pre-wrap",
                structural && "text-muted-foreground/80",
              )}
            >
              {structural ? line : highlightJson(body)}
            </span>
          </div>
        );
      })}
    </pre>
  );
}
