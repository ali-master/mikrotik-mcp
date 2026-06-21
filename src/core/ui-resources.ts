/**
 * MCP App view registry — the `ui://` HTML resources this server can render.
 *
 * This is the single source of truth for views: tools reference a view via
 * {@link uiViewUri} (e.g. `defineTool({ ui: { resourceUri: uiViewUri("dashboard") } })`),
 * and {@link registerUiResources} serves the matching built HTML so the host can
 * fetch and render it in a sandboxed iframe.
 *
 * The HTML is built (single-file) by `bun run build:ui` into `dist/ui/<id>.html`.
 * If a view hasn't been built yet, a small placeholder is served so the server
 * still runs (and the failure is obvious in the host instead of crashing).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { UI_DIST_DIR } from "../paths";

export interface UiView {
  /** Stable id — used in the resource URI and the built HTML filename. */
  id: string;
  /** Human-readable name shown in `resources/list`. */
  name: string;
  /** One-line summary. */
  description: string;
}

/** The `ui://` resource URI for a view id (shared by tools and resources). */
export function uiViewUri(id: string): string {
  return `ui://mikrotik/${id}.html`;
}

/**
 * Every MCP App view the server ships. Add a view here and reference
 * `uiViewUri(id)` from the tool that should render it.
 */
export const UI_VIEWS: UiView[] = [
  {
    id: "dashboard",
    name: "MikroTik Device Dashboard",
    description:
      "Live device health: CPU load, memory, uptime, temperature, board and RouterOS version.",
  },
];

/** Placeholder served when a view's HTML hasn't been built yet. */
function placeholderHtml(view: UiView): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${view.name}</title></head><body style="font:14px/1.5 system-ui;padding:24px;color:#9aa0a6;background:#0b0d10"><h2 style="color:#e8eaed;margin:0 0 8px">${view.name}</h2><p>This MCP App view hasn't been built yet. Run <code style="color:#7c9cff">bun run build:ui</code> to generate it.</p></body></html>`;
}

/**
 * Register every UI view as a `ui://` resource. Returns the number registered.
 * The HTML is read on each fetch so rebuilds are picked up without a restart.
 */
export function registerUiResources(server: McpServer): number {
  for (const view of UI_VIEWS) {
    const uri = uiViewUri(view.id);
    const file = join(UI_DIST_DIR, `${view.id}.html`);
    registerAppResource(
      server,
      view.name,
      uri,
      { description: view.description, mimeType: RESOURCE_MIME_TYPE },
      () => {
        let html: string;
        try {
          html = readFileSync(file, "utf8");
        } catch {
          html = placeholderHtml(view);
        }
        return { contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
      },
    );
  }
  return UI_VIEWS.length;
}
