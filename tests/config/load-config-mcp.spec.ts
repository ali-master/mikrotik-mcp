/**
 * The config-file `mcp` block must actually take effect. Previously only `s3`,
 * `dashboard` and `tools` were read from the file — `mcp` was dropped, so a user
 * setting `mcp.appViews` / `mcp.toolPageSize` in their config JSON was silently
 * ignored. These lock that the block is honoured (and the defaults when absent).
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
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

const DEVICES = { defaultDevice: "r", devices: { r: { host: "1.1.1.1", username: "admin" } } };

describe("loadConfig — config-file mcp block", () => {
  test("honours mcp.appViews=false from the config file", () => {
    const cfg = loadConfig([`--config=${cfgFile({ ...DEVICES, mcp: { appViews: false } })}`]);
    expect(cfg.mcp.appViews).toBe(false);
  });

  test("defaults mcp.appViews to true when the file omits an mcp block", () => {
    const cfg = loadConfig([`--config=${cfgFile(DEVICES)}`]);
    expect(cfg.mcp.appViews).toBe(true);
  });

  test("honours mcp.toolPageSize from the config file", () => {
    const cfg = loadConfig([`--config=${cfgFile({ ...DEVICES, mcp: { toolPageSize: 150 } })}`]);
    expect(cfg.mcp.toolPageSize).toBe(150);
  });
});
