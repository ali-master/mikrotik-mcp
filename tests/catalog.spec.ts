/**
 * Offline smoke tests for the tool catalog and the command builder.
 * These need no device — they validate the static shape of the server.
 */
import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  Cmd,
  commandUnsupported,
  containsRawParserError,
  looksLikeError,
  quoteValue,
  yesno,
} from "../src/core/routeros";
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

  test("quoteValue escapes control chars so multi-line sources stay one command", () => {
    // A real newline must become the RouterOS `\n` escape, otherwise the SSH
    // exec channel sees it as end-of-command (e.g. /system script add source=).
    expect(quoteValue("line1\nline2")).toBe('"line1\\nline2"');
    expect(quoteValue("a\r\nb")).toBe('"a\\r\\nb"');
    expect(quoteValue("a\tb")).toBe('"a\\tb"');
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

  test("commandUnsupported detects RouterOS 'command does not exist' errors", () => {
    // The exact string a v7 device returns for `/ip route cache print`.
    expect(commandUnsupported("bad command name cache (line 1 column 11)")).toBe(true);
    expect(commandUnsupported("no such command prefix")).toBe(true);
    expect(commandUnsupported("expected end of command")).toBe(true);
    // Real output and value-level failures are NOT "command unsupported".
    expect(commandUnsupported("0 D 0.0.0.0/0 gw 10.0.0.1")).toBe(false);
    expect(commandUnsupported("failure: already have such entry")).toBe(false);
  });

  test("containsRawParserError flags wrapped parser errors but not real data", () => {
    // The exact symptoms reported by users (error wrapped under a success header).
    expect(
      containsRawParserError("POE CONFIGURATION:\n\nbad command name poe (line 1 column 21)"),
    ).toBe(true);
    expect(
      containsRawParserError("DNS CACHE STATISTICS:\n\nbad parameter stats (line 1 column 26)"),
    ).toBe(true);
    expect(
      containsRawParserError("ROUTE CACHE:\n\nbad command name cache (line 1 column 11)"),
    ).toBe(true);
    // Must NOT flag legitimate output that merely contains error-ish words.
    expect(
      containsRawParserError("LOGS:\n\n12:00:00 system,error login failure for user admin"),
    ).toBe(false);
    expect(
      containsRawParserError('INTERFACES:\n\n0 R ether1 ... comment="syntax error in old note"'),
    ).toBe(false);
    expect(containsRawParserError("ROUTES:\n\n0 As 0.0.0.0/0 gateway=10.0.0.1")).toBe(false);
  });

  test("looksLikeError catches device failures, parser and value errors", () => {
    expect(looksLikeError("failure: already have such entry")).toBe(true);
    expect(looksLikeError("bad command name cache (line 1 column 11)")).toBe(true);
    // Value/parameter errors that previously slipped through as "success".
    expect(looksLikeError("bad parameter stats (line 1 column 26)")).toBe(true);
    expect(looksLikeError("invalid value for argument address")).toBe(true);
    expect(looksLikeError("input does not match any value of mode")).toBe(true);
    expect(looksLikeError("ambiguous value")).toBe(true);
    // Normal print output must not be flagged.
    expect(looksLikeError("flags: X, A")).toBe(false);
    expect(looksLikeError("cache-used: 16KiB")).toBe(false);
  });
});
