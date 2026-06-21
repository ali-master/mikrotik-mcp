/**
 * Deployment guards for public exposure (ChatGPT Apps): CORS on `/mcp` and
 * read-only mode. Pure logic — no server or network. (Vitest)
 */
import { describe, it, expect } from "vite-plus/test";
import {
  DEFAULT_CORS_ORIGINS,
  corsAllowList,
  corsHeaders,
  resolveCorsOrigin,
} from "../../src/transport/cors";
import { READ, WRITE, DESTRUCTIVE, defineTool, registerTools } from "../../src/core/registry";
import type { ToolModule } from "../../src/core/registry";

describe("CORS allow-list", () => {
  it("defaults to the known MCP-host origins", () => {
    expect(corsAllowList("")).toEqual(DEFAULT_CORS_ORIGINS);
    expect(corsAllowList("  ")).toEqual(DEFAULT_CORS_ORIGINS);
  });
  it("supports an explicit CSV list and wildcard", () => {
    expect(corsAllowList("https://a.com, https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
    expect(corsAllowList("*")).toBe("*");
  });
});

describe("resolveCorsOrigin", () => {
  it("reflects an allow-listed origin (ChatGPT) by default", () => {
    expect(resolveCorsOrigin("https://chatgpt.com", "")).toBe("https://chatgpt.com");
    expect(resolveCorsOrigin("https://claude.ai", "")).toBe("https://claude.ai");
  });
  it("rejects an unknown origin", () => {
    expect(resolveCorsOrigin("https://evil.example", "")).toBeNull();
  });
  it("returns null when there is no Origin (server-to-server)", () => {
    expect(resolveCorsOrigin(null, "")).toBeNull();
  });
  it("honours an explicit list and wildcard", () => {
    expect(resolveCorsOrigin("https://me.com", "https://me.com")).toBe("https://me.com");
    expect(resolveCorsOrigin("https://anything.com", "*")).toBe("*");
  });
});

describe("corsHeaders", () => {
  it("emits a full header set for an allowed origin", () => {
    const h = corsHeaders("https://chatgpt.com", "");
    expect(h["access-control-allow-origin"]).toBe("https://chatgpt.com");
    expect(h["access-control-allow-methods"]).toContain("OPTIONS");
    expect(h["access-control-allow-headers"]).toContain("Mcp-Session-Id");
    expect(h.vary).toBe("Origin");
  });
  it("emits nothing for a disallowed origin", () => {
    expect(corsHeaders("https://evil.example", "")).toEqual({});
  });
});

describe("read-only registration", () => {
  function fakeServer(): { server: any; names: string[] } {
    const names: string[] = [];
    return {
      server: { registerTool: (name: string) => names.push(name) },
      names,
    };
  }
  const mod: ToolModule = [
    defineTool({
      name: "look",
      title: "L",
      description: "read",
      annotations: READ,
      handler: () => "ok",
    }),
    defineTool({
      name: "change",
      title: "C",
      description: "write",
      annotations: WRITE,
      handler: () => "ok",
    }),
    defineTool({
      name: "wipe",
      title: "W",
      description: "destroy",
      annotations: DESTRUCTIVE,
      handler: () => "ok",
    }),
  ];

  it("registers every tool when read-only is off", () => {
    const { server, names } = fakeServer();
    const count = registerTools(server, [mod], {});
    expect(count).toBe(3);
    expect(names).toEqual(["look", "change", "wipe"]);
  });

  it("registers only readOnlyHint tools when read-only is on", () => {
    const { server, names } = fakeServer();
    const count = registerTools(server, [mod], { readOnly: true });
    expect(count).toBe(1);
    expect(names).toEqual(["look"]);
  });
});
