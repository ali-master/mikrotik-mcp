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
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value !== "" && BARE_SAFE.test(value)) return value;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

/** Heuristic: did the device report a failure for a mutating command? */
export function looksLikeError(result: string): boolean {
  const t = result.toLowerCase();
  return (
    t.includes("failure:") ||
    t.includes("syntax error") ||
    t.includes("bad command") ||
    t.includes("expected end of command") ||
    t.startsWith("error")
  );
}
