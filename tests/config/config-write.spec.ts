/**
 * Unit tests for the Config Studio persistence helpers. Pure — no real FS.
 */
import { describe, expect, test } from "vite-plus/test";
import { backupName, mergeSecrets, serializeConfig } from "../../src/config-write";
import { REDACTED } from "../../src/observability/event";

describe("mergeSecrets", () => {
  test("restores an untouched secret sentinel from the current config", () => {
    const current = { devices: { a: { host: "1.1.1.1", password: "s3cret" } } };
    const incoming = { devices: { a: { host: "1.1.1.1", password: REDACTED } } };
    expect(mergeSecrets(incoming, current)).toEqual({
      devices: { a: { host: "1.1.1.1", password: "s3cret" } },
    });
  });

  test("keeps a deliberately typed-in new secret", () => {
    const current = { devices: { a: { password: "old" } } };
    const incoming = { devices: { a: { password: "new-typed" } } };
    expect(mergeSecrets(incoming, current)).toEqual({
      devices: { a: { password: "new-typed" } },
    });
  });

  test("preserves structural edits: added and removed devices", () => {
    const current = { devices: { a: { password: "pa" }, b: { password: "pb" } } };
    const incoming = {
      devices: { a: { password: REDACTED }, c: { host: "3.3.3.3", password: "pc" } },
    };
    expect(mergeSecrets(incoming, current)).toEqual({
      devices: { a: { password: "pa" }, c: { host: "3.3.3.3", password: "pc" } },
    });
  });

  test("restores nested s3/dashboard secrets", () => {
    const current = {
      s3: { secretAccessKey: "real-key" },
      dashboard: { token: "real-token" },
    };
    const incoming = {
      s3: { secretAccessKey: REDACTED },
      dashboard: { token: REDACTED, port: 9090 },
    };
    expect(mergeSecrets(incoming, current)).toEqual({
      s3: { secretAccessKey: "real-key" },
      dashboard: { token: "real-token", port: 9090 },
    });
  });

  test("drops a sentinel with nothing behind it instead of persisting the marker", () => {
    const current = { devices: { a: {} } };
    const incoming = { devices: { a: { password: REDACTED } } };
    expect(mergeSecrets(incoming, current)).toEqual({ devices: { a: {} } });
  });
});

describe("serializeConfig", () => {
  test("prepends a $schema pointer and ends with a newline", () => {
    const out = serializeConfig({ defaultDevice: "a" });
    expect(out.startsWith('{\n  "$schema": "./schemas/config.schema.json"')).toBe(true);
    expect(out.endsWith("}\n")).toBe(true);
    expect(out).toContain('"defaultDevice": "a"');
  });

  test("replaces a pre-existing $schema rather than duplicating it", () => {
    const out = serializeConfig({ $schema: "stale", defaultDevice: "a" });
    expect(out.match(/\$schema/g)).toHaveLength(1);
    expect(out).toContain("./schemas/config.schema.json");
    expect(out).not.toContain("stale");
  });
});

describe("backupName", () => {
  test("suffixes the path with the timestamp", () => {
    expect(backupName("/etc/mikrotik/config.json", 1700000000000)).toBe(
      "/etc/mikrotik/config.json.bak-1700000000000",
    );
  });
});
