/**
 * The config-file's top-level scalar toggles (`readOnly`, `disableUpdateCheck`,
 * `backupDir`) must actually take effect. Previously `parseDevicesSource` dropped
 * them, so a value saved by the dashboard config editor was silently ignored on
 * reload — even though `vault.ts` documents `config.backupDir` as "persisted".
 * These lock the round-trip and the "explicit flag/env wins over the file" order.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { loadConfig } from "../../src/config";

const dirs: string[] = [];
function cfgFile(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "mt-cfg-"));
  dirs.push(dir);
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
}
afterEach(() => {
  delete process.env.MIKROTIK_BACKUP_DIR;
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

const DEVICES = { defaultDevice: "r", devices: { r: { host: "1.1.1.1", username: "admin" } } };

describe("loadConfig — top-level config-file toggles", () => {
  test("honours readOnly / disableUpdateCheck / backupDir from the config file", () => {
    const cfg = loadConfig([
      `--config=${cfgFile({ ...DEVICES, readOnly: true, disableUpdateCheck: true, backupDir: "/vault/here" })}`,
    ]);
    expect(cfg.readOnly).toBe(true);
    expect(cfg.disableUpdateCheck).toBe(true);
    expect(cfg.backupDir).toBe("/vault/here");
  });

  test("defaults readOnly/disableUpdateCheck to false when the file omits them", () => {
    const cfg = loadConfig([`--config=${cfgFile(DEVICES)}`]);
    expect(cfg.readOnly).toBe(false);
    expect(cfg.disableUpdateCheck).toBe(false);
    expect(cfg.backupDir).toBeUndefined();
  });

  test("an explicit flag overrides the file value (flags win)", () => {
    const p = cfgFile({ ...DEVICES, readOnly: true });
    expect(loadConfig([`--config=${p}`, "--read-only", "false"]).readOnly).toBe(false);
  });

  test("MIKROTIK_BACKUP_DIR env overrides the file's backupDir", () => {
    process.env.MIKROTIK_BACKUP_DIR = "/from/env";
    const cfg = loadConfig([`--config=${cfgFile({ ...DEVICES, backupDir: "/from/file" })}`]);
    expect(cfg.backupDir).toBe("/from/env");
  });
});
