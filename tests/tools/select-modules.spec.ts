/**
 * Offline tests for `selectToolModules` — the tool-surface curation that lets a
 * deployment expose only the scopes it needs (so the client's tool search
 * reliably surfaces every matching tool on a several-hundred-tool server).
 */
import { describe, expect, test } from "vite-plus/test";
import { moduleCatalog, selectToolModules } from "../../src/tools";
import type { ModuleInfo } from "../../src/tools";

const fakeTool = (name: string) => ({ name }) as unknown as ModuleInfo["tools"][number];
const mod = (slug: string, group: string): ModuleInfo => ({
  label: slug,
  slug,
  group,
  description: slug,
  tools: [fakeTool(`${slug}_tool`)],
});

const CATALOG: ModuleInfo[] = [
  mod("wireguard", "VPN"),
  mod("wireguard-mesh", "VPN"),
  mod("firewall", "Firewall"),
  mod("interfaces", "Interfaces"),
];

const slugs = (mods: ReturnType<typeof selectToolModules>): string[] =>
  mods.map((m) => (m[0] as unknown as { name: string }).name);

describe("selectToolModules", () => {
  test("empty filter returns the whole catalog, order preserved", () => {
    const out = selectToolModules({}, CATALOG);
    expect(out).toHaveLength(CATALOG.length);
    expect(slugs(out)).toEqual([
      "wireguard_tool",
      "wireguard-mesh_tool",
      "firewall_tool",
      "interfaces_tool",
    ]);
  });

  test("no-arg call curates the real catalog to its full size", () => {
    expect(selectToolModules()).toHaveLength(moduleCatalog.length);
  });

  test("enabledModules is an allow-list (only matched slugs survive)", () => {
    const out = selectToolModules({ enabledModules: ["wireguard"] }, CATALOG);
    expect(slugs(out)).toEqual(["wireguard_tool"]);
  });

  test("enabledGroups allows every module in the group", () => {
    const out = selectToolModules({ enabledGroups: ["VPN"] }, CATALOG);
    expect(slugs(out)).toEqual(["wireguard_tool", "wireguard-mesh_tool"]);
  });

  test("disabledModules subtracts from the full surface", () => {
    const out = selectToolModules({ disabledModules: ["wireguard-mesh"] }, CATALOG);
    expect(slugs(out)).toEqual(["wireguard_tool", "firewall_tool", "interfaces_tool"]);
  });

  test("disabledGroups removes a whole group", () => {
    const out = selectToolModules({ disabledGroups: ["VPN"] }, CATALOG);
    expect(slugs(out)).toEqual(["firewall_tool", "interfaces_tool"]);
  });

  test("deny wins over allow when a module is in both lists", () => {
    const out = selectToolModules(
      { enabledGroups: ["VPN"], disabledModules: ["wireguard-mesh"] },
      CATALOG,
    );
    expect(slugs(out)).toEqual(["wireguard_tool"]);
  });

  test("matching is case-insensitive on slug and group", () => {
    const out = selectToolModules(
      { enabledModules: ["WireGuard"], enabledGroups: ["firewall"] },
      CATALOG,
    );
    expect(slugs(out)).toEqual(["wireguard_tool", "firewall_tool"]);
  });

  test("an allow-list that matches nothing yields an empty surface", () => {
    expect(selectToolModules({ enabledModules: ["does-not-exist"] }, CATALOG)).toEqual([]);
  });
});
