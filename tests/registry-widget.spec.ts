/**
 * Auto-records widget gating.
 *
 * Every `list_*`/`get_*`/`show_*`/`print_*` read tool may auto-attach the shared
 * "records" MCP App view. But attaching it to a NON-TABULAR read (a message like
 * "no PoE-out hardware", a "not found" reply, a single sentence) renders a blank
 * widget AND makes the host suppress the text answer ("rendered an interactive
 * widget"). The registry must only attach the widget when the output actually
 * parsed into rows; otherwise it returns plain text so the answer stays visible.
 */
import { describe, expect, test } from "vite-plus/test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { READ, defineTool } from "../src/core/registry";
import type { RegisterableTool } from "../src/core/registry";

/** Register a tool against a fake server, capturing both its config and callback. */
function register(tool: RegisterableTool): {
  cfg: { outputSchema?: unknown; _meta?: unknown };
  call: (args?: Record<string, unknown>) => Promise<CallToolResult>;
} {
  let cfg: { outputSchema?: unknown; _meta?: unknown } = {};
  let cb: ((a: Record<string, unknown>) => Promise<CallToolResult>) | undefined;
  tool.register({
    registerTool: (_name: string, config: unknown, callback: unknown) => {
      cfg = config as typeof cfg;
      cb = callback as (a: Record<string, unknown>) => Promise<CallToolResult>;
    },
  } as never);
  return { cfg, call: (args = {}) => cb!(args) };
}

/** Convenience: drive a tool's callback directly (no device). */
async function drive(tool: RegisterableTool, args: Record<string, unknown> = {}) {
  return register(tool).call(args);
}

describe("auto-records widget gating", () => {
  test("a non-tabular read returns plain text, NOT a blank widget", async () => {
    const tool = defineTool({
      name: "list_widget_probe_message",
      title: "Probe",
      description: "probe",
      annotations: READ,
      inputSchema: {},
      handler: () => "PoE input is healthy on this board.",
    });
    const res = await drive(tool);
    // No widget attached → the host shows the real text, not "rendered a widget".
    expect(res.structuredContent).toBeUndefined();
    expect(res.content[0]).toMatchObject({ type: "text" });
    expect((res.content[0] as { text: string }).text).toContain("PoE input is healthy");
  });

  test("a tabular read still attaches the records widget", async () => {
    const tool = defineTool({
      name: "list_widget_probe_rows",
      title: "Probe",
      description: "probe",
      annotations: READ,
      inputSchema: {},
      handler: () =>
        "Flags: X - disabled\n 0   name=ether1 type=ether mtu=1500\n 1 X name=ether2 type=ether mtu=1500",
    });
    const res = await drive(tool);
    expect(res.structuredContent).toBeDefined();
    expect((res.structuredContent as { __mikrotikView?: string }).__mikrotikView).toBe("records");
    expect((res.structuredContent as { rows: unknown[] }).rows.length).toBe(2);
  });
});

describe("output schema on MCP App tools (matches the ext-apps examples)", () => {
  test("an EXPLICIT app-view tool declares an outputSchema + the ui _meta", () => {
    const tool = defineTool({
      name: "show_probe_view",
      title: "Probe",
      description: "probe",
      annotations: READ,
      ui: { resourceUri: "ui://mikrotik/probe.html" },
      inputSchema: {},
      handler: () => ({ text: "ok", structuredContent: { value: 1 } }),
    });
    const { cfg } = register(tool);
    expect(cfg.outputSchema).toBeDefined();
    expect(cfg._meta).toBeDefined();
  });

  test("the AUTO-records view does NOT declare an outputSchema", () => {
    // It legitimately omits structuredContent for non-tabular reads, so a
    // declared output schema would make the SDK throw.
    const tool = defineTool({
      name: "list_probe_auto",
      title: "Probe",
      description: "probe",
      annotations: READ,
      inputSchema: {},
      handler: () => "some rows",
    });
    const { cfg } = register(tool);
    expect(cfg.outputSchema).toBeUndefined();
    expect(cfg._meta).toBeDefined(); // still advertises the auto records ui
  });

  test("a plain non-UI tool declares neither outputSchema nor ui _meta", () => {
    const tool = defineTool({
      name: "remove_probe_thing",
      title: "Probe",
      description: "probe",
      annotations: READ,
      inputSchema: {},
      handler: () => "done",
    });
    const { cfg } = register(tool);
    expect(cfg.outputSchema).toBeUndefined();
    expect(cfg._meta).toBeUndefined();
  });
});
