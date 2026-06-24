/**
 * Unit tests for the config version-history store — record/list/read/delete,
 * retention (prune old `auto` but keep checkpoints), and the empty check, all
 * over a temp directory via the MIKROTIK_CONFIG_HISTORY_DIR override.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  AUTO_RETENTION,
  deleteVersion,
  isEmpty,
  listVersions,
  readVersion,
  recordVersion,
} from "../../src/observability/config-history";

describe("config-history", () => {
  let dir: string;
  let prev: string | undefined;
  beforeAll(() => {
    prev = process.env.MIKROTIK_CONFIG_HISTORY_DIR;
    dir = mkdtempSync(join(tmpdir(), "mt-cfghist-"));
    process.env.MIKROTIK_CONFIG_HISTORY_DIR = dir;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.MIKROTIK_CONFIG_HISTORY_DIR;
    else process.env.MIKROTIK_CONFIG_HISTORY_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  test("empty until the first record", () => {
    expect(isEmpty()).toBe(true);
    expect(listVersions()).toEqual([]);
  });

  test("record → list (newest first) → read → delete", () => {
    const a = recordVersion({ readOnly: false }, "auto", 1000, "baseline");
    const b = recordVersion({ readOnly: true }, "checkpoint", 2000, "locked");
    expect(isEmpty()).toBe(false);

    const list = listVersions();
    expect(list.map((v) => v.id)).toEqual([b.id, a.id]); // newest first
    expect(list[0].kind).toBe("checkpoint");
    expect(list[0].label).toBe("locked");

    expect(readVersion(a.id).config).toEqual({ readOnly: false });
    expect(deleteVersion(a.id)).toBe(true);
    expect(deleteVersion(a.id)).toBe(false);
    expect(listVersions().map((v) => v.id)).toEqual([b.id]);
  });

  test("collision on the same timestamp still yields unique ids", () => {
    const x = recordVersion({ n: 1 }, "auto", 5000);
    const y = recordVersion({ n: 2 }, "auto", 5000);
    expect(x.id).not.toBe(y.id);
  });

  test("retention prunes oldest auto versions but keeps checkpoints", () => {
    const fresh = mkdtempSync(join(tmpdir(), "mt-cfghist2-"));
    process.env.MIKROTIK_CONFIG_HISTORY_DIR = fresh;
    try {
      const keep = recordVersion({ pinned: true }, "checkpoint", 1, "keep-me");
      for (let i = 0; i < AUTO_RETENTION + 10; i++) {
        recordVersion({ i }, "auto", 100 + i);
      }
      const all = listVersions();
      const autos = all.filter((v) => v.kind === "auto");
      expect(autos.length).toBe(AUTO_RETENTION);
      // The named checkpoint survives even though it is the oldest entry.
      expect(all.some((v) => v.id === keep.id)).toBe(true);
    } finally {
      process.env.MIKROTIK_CONFIG_HISTORY_DIR = dir;
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});
