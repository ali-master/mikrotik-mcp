/**
 * Shared MCP App view kit — small, dependency-light helpers reused across the
 * MikroTik views (records, interfaces, firewall).
 *
 * Everything here builds DOM with `textContent`/element nodes (never
 * `innerHTML`), so device-supplied strings can never inject markup, and wires
 * the host bridge (theme, fonts, safe-area) the same way in every view.
 */
import {
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  getDocumentTheme,
} from "@modelcontextprotocol/ext-apps";
import type { App } from "@modelcontextprotocol/ext-apps";

export type Child = Node | string | null | undefined | false;

/** Tiny hyperscript helper: `h("div", { class: "x" }, "text", childNode)`. */
export function h(tag: string, props: Record<string, string> = {}, ...kids: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === false || kid == null) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** A `<button class="btn">` with a click handler (and optional modifier class). */
export function button(
  label: string,
  onClick: () => void,
  opts: { class?: string; title?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const el = h("button", {
    class: `btn${opts.class ? ` ${opts.class}` : ""}`,
    ...(opts.title ? { title: opts.title } : {}),
  }) as HTMLButtonElement;
  el.textContent = label;
  if (opts.disabled) el.disabled = true;
  el.addEventListener("click", onClick);
  return el;
}

/** Format a byte count as a binary size (`124.0 MiB`), or `—` when unknown. */
export function bytes(n: number | null | undefined): string {
  if (n == null) return "—";
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

/** Severity class for a 0–100 percentage (green / amber / red). */
export function severity(pct: number | null | undefined): string {
  if (pct == null) return "";
  return pct >= 90 ? "is-bad" : pct >= 70 ? "is-warn" : "is-good";
}

/** Copy text to the clipboard, falling back to a hidden textarea + execCommand. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      ta.remove();
    }
  }
}

/** Trigger a client-side download of `text` as `filename`. */
export function download(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Serialise rows to CSV with the given ordered columns (RFC-4180 quoting). */
export function toCsv(columns: string[], rows: Record<string, string>[]): string {
  const esc = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = columns.map(esc).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c] ?? "")).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

/**
 * Wire the standard host-context handler onto an App instance: theme, host CSS
 * variables/fonts and safe-area insets. Call once after constructing the App.
 */
export function wireHostContext(app: App): void {
  app.onhostcontextchanged = (ctx) => {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
    if (ctx.safeAreaInsets) {
      const { top, right, bottom, left } = ctx.safeAreaInsets;
      document.body.style.padding = `${top + 16}px ${right + 16}px ${bottom + 16}px ${left + 16}px`;
    }
  };
  applyDocumentTheme(getDocumentTheme());
}
