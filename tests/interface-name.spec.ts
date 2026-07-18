/**
 * The shared interface-name schema rejects whitespace (RouterOS silently fails an
 * interface `add`/rename whose name has a space) and the create-interface tools
 * actually use it.
 */
import { describe, expect, test } from "vite-plus/test";
import { interfaceName } from "../src/core/schema";
import { allToolModules } from "../src/tools/index";

describe("interfaceName", () => {
  test("rejects a name with a space", () => {
    const r = interfaceName().safeParse("wireguard internal");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/dash/i);
  });

  test("rejects tabs/newlines and empty", () => {
    expect(interfaceName().safeParse("a\tb").success).toBe(false);
    expect(interfaceName().safeParse("a\nb").success).toBe(false);
    expect(interfaceName().safeParse("").success).toBe(false);
  });

  test("accepts a dash-separated name", () => {
    expect(interfaceName().safeParse("wireguard-internal").success).toBe(true);
    expect(interfaceName().safeParse("vlan100").success).toBe(true);
  });
});

describe("create-interface tools enforce it", () => {
  // A representative set of tools whose `name` becomes a new RouterOS interface.
  const CREATE_TOOLS = [
    "create_wireguard_interface",
    "create_vlan_interface",
    "create_bridge",
    "create_gre_tunnel",
    "create_l2tp_client",
  ];

  const byName = new Map(allToolModules.flat().map((t) => [t.name, t]));

  for (const name of CREATE_TOOLS) {
    test(`${name} rejects a spaced interface name`, () => {
      const tool = byName.get(name);
      expect(tool, `tool ${name} not found — update this list if it was renamed`).toBeTruthy();
      const shape = tool!.inputSchema as unknown as Record<
        string,
        { safeParse: (v: unknown) => { success: boolean } }
      >;
      expect(shape.name, `${name} has no 'name' field`).toBeTruthy();
      expect(shape.name.safeParse("bad name").success).toBe(false);
      expect(shape.name.safeParse("good-name").success).toBe(true);
    });
  }
});
