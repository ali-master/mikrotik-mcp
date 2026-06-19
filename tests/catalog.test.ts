/**
 * Offline smoke tests for the tool catalog and the command builder.
 * These need no device — they validate the static shape of the server.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Cmd, quoteValue, yesno } from "../src/core/routeros";
import { allToolModules, moduleCatalog } from "../src/tools";

const allTools = allToolModules.flat();

describe("tool catalog", () => {
  test("registers a substantial number of tools", () => {
    expect(allTools.length).toBeGreaterThanOrEqual(300);
  });

  test("tool names are unique", () => {
    const seen = new Set<string>();
    for (const t of allTools) {
      expect(seen.has(t.name)).toBe(false);
      seen.add(t.name);
    }
  });

  test("tool names are snake_case", () => {
    for (const t of allTools) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  test("every tool has a title, a non-trivial description, and annotations", () => {
    for (const t of allTools) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.annotations).toBeDefined();
    }
  });

  test("input schemas are valid Zod shapes that produce JSON Schema", () => {
    for (const t of allTools) {
      const shape = t.inputSchema ?? {};
      expect(() => z.toJSONSchema(z.object(shape))).not.toThrow();
    }
  });

  test("moduleCatalog slugs are unique and cover every module", () => {
    const slugs = new Set(moduleCatalog.map((m) => m.slug));
    expect(slugs.size).toBe(moduleCatalog.length);
    expect(moduleCatalog.length).toBe(allToolModules.length);
  });
});

describe("RouterOS command builder", () => {
  test("quoteValue leaves bare-safe tokens unquoted", () => {
    expect(quoteValue("ether1")).toBe("ether1");
    expect(quoteValue("192.168.1.0/24")).toBe("192.168.1.0/24");
    expect(quoteValue(42)).toBe("42");
  });

  test("quoteValue quotes values with spaces", () => {
    expect(quoteValue("My LAN")).toBe('"My LAN"');
  });

  test("quoteValue neutralises console-injection attempts", () => {
    // A semicolon would otherwise start a second RouterOS command.
    const malicious = "lan; /system reset-configuration";
    const quoted = quoteValue(malicious);
    expect(quoted.startsWith('"')).toBe(true);
    expect(quoted.endsWith('"')).toBe(true);
    // The dangerous payload stays inside the quotes (no bare semicolon escapes).
    expect(quoted).toBe(`"${malicious}"`);
  });

  test("quoteValue escapes embedded quotes and backslashes", () => {
    expect(quoteValue('a"b')).toBe('"a\\"b"');
    expect(quoteValue("a\\b")).toBe('"a\\\\b"');
  });

  test("Cmd builds add commands with optional/flag/bool fragments", () => {
    const cmd = new Cmd("/interface vlan add")
      .set("name", "vlan100")
      .set("vlan-id", 100)
      .opt("comment", "office uplink")
      .opt("mtu", undefined)
      .flag("disabled", false)
      .flag("use-service-tag", true)
      .bool("running", false)
      .build();
    expect(cmd).toBe(
      '/interface vlan add name=vlan100 vlan-id=100 comment="office uplink" use-service-tag=yes running=no',
    );
  });

  test("yesno maps booleans", () => {
    expect(yesno(true)).toBe("yes");
    expect(yesno(false)).toBe("no");
  });
});
