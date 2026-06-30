/**
 * Unit tests for the local backup vault — the pure command-reconstruction and
 * the path-traversal guard, plus a round-trip over a temp directory.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  deleteBackup,
  exportToCommands,
  listBackups,
  readBackup,
  renameBackup,
  safeName,
  writeBackup,
  writeBinaryBackup,
} from "../../src/backups/vault";

describe("exportToCommands", () => {
  test("prefixes each item line with its section path", () => {
    const exp = [
      "# 2026-06-25 10:00:00 by RouterOS 7.23",
      "/ip firewall filter",
      "add chain=input action=accept",
      "add chain=input action=drop",
      "/ip address",
      "add address=10.0.0.1/24 interface=ether1",
      "/system identity",
      "set name=Router",
      "",
    ].join("\n");
    expect(exportToCommands(exp)).toEqual([
      "/ip firewall filter add chain=input action=accept",
      "/ip firewall filter add chain=input action=drop",
      "/ip address add address=10.0.0.1/24 interface=ether1",
      "/system identity set name=Router",
    ]);
  });

  test("skips comments/blanks and joins backslash line-continuations", () => {
    const exp = "/ip firewall filter\nadd chain=forward \\\n    action=accept comment=ok\n\n# tail";
    expect(exportToCommands(exp)).toEqual([
      "/ip firewall filter add chain=forward action=accept comment=ok",
    ]);
  });
});

describe("safeName", () => {
  test("accepts a plain filename", () => {
    expect(safeName("edge_2026-06-25_1430.rsc")).toBe("edge_2026-06-25_1430.rsc");
  });
  test("rejects path traversal and separators", () => {
    for (const bad of ["../etc/passwd", "a/b.rsc", "..", ".", "x/../y", "/abs"]) {
      expect(() => safeName(bad)).toThrow();
    }
  });
});

describe("vault round-trip (temp dir)", () => {
  let dir: string;
  let prev: string | undefined;
  beforeAll(() => {
    prev = process.env.MIKROTIK_BACKUP_DIR;
    dir = mkdtempSync(join(tmpdir(), "mt-vault-"));
    process.env.MIKROTIK_BACKUP_DIR = dir;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.MIKROTIK_BACKUP_DIR;
    else process.env.MIKROTIK_BACKUP_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  test("write (unique on collision) → read → list → rename → delete", () => {
    const a = writeBackup("edge_x.rsc", "/system identity\nset name=A");
    const b = writeBackup("edge_x.rsc", "second"); // same name → suffixed
    expect(a).toBe("edge_x.rsc");
    expect(b).toBe("edge_x_2.rsc");
    expect(readBackup("edge_x.rsc")).toContain("set name=A");

    const list = listBackups();
    expect(list.map((x) => x.name).sort()).toEqual(["edge_x.rsc", "edge_x_2.rsc"]);
    expect(list[0].device).toBe("edge");
    expect(list[0].type).toBe("rsc");

    const renamed = renameBackup("edge_x.rsc", "golden");
    expect(renamed).toBe("golden.rsc");
    expect(deleteBackup("golden.rsc")).toBe(true);
    expect(deleteBackup("nope.rsc")).toBe(false);
  });

  test("writeBinaryBackup round-trip with collision avoidance", () => {
    const data = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x42]);
    const a = writeBinaryBackup("router_snap.backup", data);
    const b = writeBinaryBackup("router_snap.backup", data);
    expect(a).toBe("router_snap.backup");
    expect(b).toBe("router_snap_2.backup");

    const list = listBackups();
    const binFiles = list.filter((x) => x.type === "backup");
    expect(binFiles.length).toBe(2);
    expect(binFiles.every((x) => x.type === "backup")).toBe(true);
    expect(binFiles[0].device).toBe("router");

    expect(deleteBackup("router_snap.backup")).toBe(true);
    expect(deleteBackup("router_snap_2.backup")).toBe(true);
  });

  test("listBackups includes both .rsc and .backup files", () => {
    writeBackup("mixed_test.rsc", "# config");
    writeBinaryBackup("mixed_test.backup", Buffer.from([0x42]));

    const list = listBackups();
    const names = list.map((x) => x.name);
    expect(names).toContain("mixed_test.rsc");
    expect(names).toContain("mixed_test.backup");

    const rsc = list.find((x) => x.name === "mixed_test.rsc");
    const bin = list.find((x) => x.name === "mixed_test.backup");
    expect(rsc!.type).toBe("rsc");
    expect(bin!.type).toBe("backup");

    deleteBackup("mixed_test.rsc");
    deleteBackup("mixed_test.backup");
  });
});
