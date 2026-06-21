/**
 * MCP Apps — registry UI extension (Vitest).
 *
 * Verifies that `defineTool` opts a tool into an interactive view without
 * disturbing plain tools: UI metadata is advertised on the registration, and a
 * handler may return `structuredContent` for the view while keeping its text
 * fallback. No device or network is touched.
 */
import { describe, it, expect } from "vite-plus/test";
import { defineTool, READ } from "../../src/core/registry";
import {
  toolUiMeta,
  UI_RESOURCE_MIME_TYPE,
  UI_RESOURCE_URI_LEGACY_KEY,
  OPENAI_OUTPUT_TEMPLATE_KEY,
} from "../../src/core/ui-meta";
import { uiViewUri, UI_VIEWS } from "../../src/core/ui-resources";

interface Captured {
  name: string;
  config: Record<string, any>;
  cb: (args: Record<string, unknown>) => Promise<any>;
}

/** Minimal fake McpServer that records `registerTool` calls. */
function fakeServer(): { server: any; calls: Captured[] } {
  const calls: Captured[] = [];
  const server = {
    registerTool: (name: string, config: any, cb: any) => calls.push({ name, config, cb }),
  };
  return { server, calls };
}

describe("toolUiMeta", () => {
  it("advertises the view under all host-specific keys", () => {
    const meta = toolUiMeta({ resourceUri: "ui://mikrotik/x.html" });
    expect(meta.ui).toEqual({ resourceUri: "ui://mikrotik/x.html" });
    expect(meta[UI_RESOURCE_URI_LEGACY_KEY]).toBe("ui://mikrotik/x.html");
    expect(meta[OPENAI_OUTPUT_TEMPLATE_KEY]).toBe("ui://mikrotik/x.html");
  });

  it("includes visibility when provided", () => {
    const meta = toolUiMeta({
      resourceUri: "ui://mikrotik/x.html",
      visibility: ["app"],
    });
    expect(meta.ui).toEqual({
      resourceUri: "ui://mikrotik/x.html",
      visibility: ["app"],
    });
  });

  it("uses the MCP App profile mime type", () => {
    expect(UI_RESOURCE_MIME_TYPE).toBe("text/html;profile=mcp-app");
  });
});

describe("defineTool — plain tools are unchanged", () => {
  it("registers no _meta and wraps a string result as text", async () => {
    const tool = defineTool({
      name: "plain_tool",
      title: "Plain",
      description: "plain text tool",
      annotations: READ,
      handler: () => "hello world",
    });
    const { server, calls } = fakeServer();
    tool.register(server);

    expect(calls).toHaveLength(1);
    expect(calls[0].config._meta).toBeUndefined();
    expect(tool.ui).toBeUndefined();

    const result = await calls[0].cb({});
    expect(result.content[0].text).toBe("hello world");
    expect(result.structuredContent).toBeUndefined();
  });
});

describe("defineTool — UI-enabled tools", () => {
  const resourceUri = uiViewUri("dashboard");

  it("advertises the ui:// resource on the registration", () => {
    const tool = defineTool({
      name: "ui_tool",
      title: "UI Tool",
      description: "renders a view",
      annotations: READ,
      ui: { resourceUri },
      handler: () => ({ text: "summary", structuredContent: { a: 1 } }),
    });
    const { server, calls } = fakeServer();
    tool.register(server);

    expect(tool.ui).toEqual({ resourceUri });
    const meta = calls[0].config._meta;
    expect(meta.ui.resourceUri).toBe(resourceUri);
    expect(meta[OPENAI_OUTPUT_TEMPLATE_KEY]).toBe(resourceUri);
  });

  it("passes structuredContent through to the result for the view", async () => {
    const tool = defineTool({
      name: "ui_tool2",
      title: "UI Tool 2",
      description: "renders a view",
      annotations: READ,
      ui: { resourceUri },
      handler: () => ({ text: "summary", structuredContent: { cpu: 42 } }),
    });
    const { server, calls } = fakeServer();
    tool.register(server);

    const result = await calls[0].cb({});
    expect(result.content[0].text).toBe("summary"); // text fallback preserved
    expect(result.structuredContent).toEqual({ cpu: 42 });
  });

  it("still works when a UI tool returns a plain string (no structured data)", async () => {
    const tool = defineTool({
      name: "ui_tool3",
      title: "UI Tool 3",
      description: "renders a view",
      annotations: READ,
      ui: { resourceUri },
      handler: () => "just text",
    });
    const { server, calls } = fakeServer();
    tool.register(server);

    const result = await calls[0].cb({});
    expect(result.content[0].text).toBe("just text");
    expect(result.structuredContent).toBeUndefined();
  });
});

describe("UI view registry", () => {
  it("builds a stable ui:// uri from a view id", () => {
    expect(uiViewUri("dashboard")).toBe("ui://mikrotik/dashboard.html");
  });

  it("has at least one view with unique ids", () => {
    expect(UI_VIEWS.length).toBeGreaterThan(0);
    const ids = new Set(UI_VIEWS.map((v) => v.id));
    expect(ids.size).toBe(UI_VIEWS.length);
  });
});
