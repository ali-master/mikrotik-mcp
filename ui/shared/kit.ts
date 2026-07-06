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

/** Default connect timeout — 10 s is long enough for a healthy host. */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Connect the App to the host with a short timeout and visible error feedback.
 *
 * The ext-apps SDK defaults to a 60 s timeout for the `ui/initialize` handshake.
 * That leaves users staring at "Waiting for data…" for a full minute before
 * discovering the host never responded. This wrapper:
 *
 *  1. Cuts the timeout to 10 s.
 *  2. Returns a boolean so the caller knows whether the bridge is live.
 *  3. Renders a user-visible diagnostic into `root` on failure so the view
 *     doesn't stay stuck on the skeleton state.
 *  4. Uses `console.log` (not `.debug`) so lifecycle events are visible by
 *     default in every browser.
 */
export async function connectApp(app: App, tag: string, root: HTMLElement): Promise<boolean> {
  try {
    await app.connect(undefined, { timeout: CONNECT_TIMEOUT_MS });
    console.warn(`[${tag}] connected`, {
      host: app.getHostVersion(),
      caps: app.getHostCapabilities(),
    });
    return true;
  } catch (err) {
    console.error(`[${tag}] connect failed`, err);
    const msg =
      err instanceof Error && /timed?\s*out/i.test(err.message)
        ? "The MCP App host did not respond — make sure your client supports MCP Apps (ext-apps)."
        : `Connection failed: ${err instanceof Error ? err.message : String(err)}`;
    root.replaceChildren(h("div", { class: "skeleton" }, msg));
    return false;
  }
}
