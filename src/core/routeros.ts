/**
 * Helpers for assembling RouterOS CLI commands safely and concisely.
 *
 * Two jobs:
 *   1. Cut the per-tool boilerplate of conditionally appending `key=value`
 *      pairs (the dominant pattern across all 17 scope modules).
 *   2. **Quote/escape values correctly.** The RouterOS console treats `;` as a
 *      command separator and whitespace as an argument separator, so an
 *      unquoted user-supplied value such as `My LAN; /system reset` would split
 *      into extra commands. `Cmd` quotes any value that isn't a bare-safe token
 *      and escapes embedded quotes/backslashes — this is the injection boundary.
 */

/** Characters that are safe to pass to the RouterOS console without quoting. */
const BARE_SAFE = /^[\w.\-:/,*@]+$/;

/** Quote and escape a value for the RouterOS console if it isn't a bare token. */
export function quoteValue(value: string | number | boolean): string {
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value !== "" && BARE_SAFE.test(value)) return value;
  // Escape, in order: backslash, double-quote, then control chars into their
  // RouterOS escape sequences. Literal newlines/tabs must become `\n`/`\r`/`\t`
  // because the command is sent over the SSH `exec` channel as a single line —
  // a raw newline would terminate the console command mid-string (e.g. a
  // multi-line `/system script add source=...`) rather than stay inside the
  // quotes.
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

export function yesno(value: boolean): "yes" | "no" {
  return value ? "yes" : "no";
}

/**
 * Fluent builder for RouterOS `add` / `set` style commands.
 *
 * ```ts
 * new Cmd("/interface vlan add")
 *   .set("name", name)
 *   .set("vlan-id", vlanId)
 *   .opt("comment", comment)          // appended only if defined
 *   .flag("disabled", disabled)       // appended only when true -> disabled=yes
 *   .bool("use-service-tag", useTag)  // appended as yes/no when not null
 *   .build();
 * ```
 */
export class Cmd {
  private parts: string[];

  constructor(base: string) {
    this.parts = [base];
  }

  /** Always append `key=value` (value is quoted/escaped as needed). */
  set(key: string, value: string | number | boolean): this {
    this.parts.push(`${key}=${quoteValue(value)}`);
    return this;
  }

  /** Append `key=value` only when `value` is neither undefined nor null. */
  opt(key: string, value: string | number | null | undefined): this {
    if (value !== undefined && value !== null && value !== "") {
      this.parts.push(`${key}=${quoteValue(value)}`);
    }
    return this;
  }

  /** Append `key=yes` only when `value` is true (the "if x: cmd += ' x=yes'" idiom). */
  flag(key: string, value: boolean | undefined | null): this {
    if (value) this.parts.push(`${key}=yes`);
    return this;
  }

  /** Append `key=yes|no` when `value` is defined (for explicit tri-state updates). */
  bool(key: string, value: boolean | undefined | null): this {
    if (value !== undefined && value !== null) {
      this.parts.push(`${key}=${yesno(value)}`);
    }
    return this;
  }

  /** Append a pre-formatted fragment verbatim (escape hatch). */
  raw(fragment: string | undefined | null): this {
    if (fragment) this.parts.push(fragment);
    return this;
  }

  build(): string {
    return this.parts.join(" ");
  }

  toString(): string {
    return this.build();
  }
}

/** Build a `where` clause from `field~value` / `field=value` fragments. */
export function whereClause(filters: string[]): string {
  return filters.length ? ` where ${filters.join(" ")}` : "";
}

/** True when RouterOS returned nothing meaningful for a query. */
export function isEmpty(result: string): boolean {
  const t = result.trim();
  return t === "" || t === "no such item" || t === "no such item (4)";
}

/**
 * Heuristic: did the device reject the command? Covers RouterOS console parser
 * and value errors that would otherwise be wrapped in a success message — value
 * failures (`failure:`), parser errors (`syntax error`, `bad command`,
 * `bad parameter`, `expected end of command`), and argument errors
 * (`invalid value`, `input does not match …`, `ambiguous value`).
 */
export function looksLikeError(result: string): boolean {
  const t = result.toLowerCase();
  return (
    t.includes("failure:") ||
    t.includes("syntax error") ||
    t.includes("bad command") ||
    t.includes("bad parameter") ||
    t.includes("expected end of command") ||
    t.includes("invalid value") ||
    t.includes("input does not match") ||
    t.includes("ambiguous value") ||
    t.startsWith("error")
  );
}

/**
 * True when RouterOS rejected the command word itself — i.e. the command path
 * does not exist on this RouterOS version (e.g. `/ip route cache`, removed in
 * v7) or was mistyped. Distinct from a value-level `failure:`; lets a tool give
 * a version-aware message instead of surfacing a raw parser error.
 */
export function commandUnsupported(result: string): boolean {
  const t = result.toLowerCase();
  return (
    t.includes("bad command name") ||
    t.includes("no such command") ||
    t.includes("no such command prefix") ||
    t.includes("expected end of command") ||
    t.includes("invalid command name")
  );
}

const PARSER_ERROR_HEAD =
  /^(?:bad command name|no such command|expected end of command|bad parameter|syntax error|ambiguous (?:command|value)|invalid value|input does not match)/i;

/**
 * Detects a RAW RouterOS console parser error left in a tool's output — e.g. a
 * read tool that printed "bad command name poe (line 1 column 21)" under a
 * success header. Used by the registry as a backstop so such results are marked
 * `isError` instead of looking like success.
 *
 * False-positive safe by design: RouterOS parser errors *begin* with the error
 * phrase AND carry a "(line N column M)" suffix. Neither appears that way in
 * print output or log lines (which begin with timestamps/flags), so legitimate
 * data containing the word "error" is never flagged.
 */
export function containsRawParserError(text: string): boolean {
  // Strip a leading "HEADER:\n\n" that tools prepend to raw device output.
  const body = text.includes("\n\n")
    ? text.slice(text.indexOf("\n\n") + 2)
    : text;
  const firstLine = body.trimStart().split("\n", 1)[0] ?? "";
  return (
    PARSER_ERROR_HEAD.test(firstLine) &&
    /\(line \d+ column \d+\)/.test(firstLine)
  );
}
