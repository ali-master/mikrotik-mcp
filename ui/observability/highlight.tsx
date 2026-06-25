import type { ReactNode } from "react";

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
    let cls: string;
    if (m[1] !== undefined) cls = /:\s*$/.test(tok) ? "j-key" : "j-str";
    else if (m[2] !== undefined) cls = tok === "null" ? "j-null" : "j-bool";
    else cls = "j-num";
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
    let cls = "ros-num";
    if (m[1] !== undefined) cls = "ros-comment";
    else if (m[2] !== undefined) cls = "ros-str";
    else if (m[3] !== undefined) cls = "ros-mac";
    else if (m[4] !== undefined) cls = "ros-ip";
    else if (m[5] !== undefined) cls = "ros-key";
    else if (m[6] !== undefined) cls = "ros-good";
    else if (m[7] !== undefined) cls = "ros-bad";
    else if (m[8] !== undefined) cls = "ros-bool";
    else if (m[9] !== undefined) cls = "ros-dim";
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
    <pre className="body json" style={maxHeight ? { maxHeight } : undefined}>
      {highlightJson(json)}
    </pre>
  );
}
