/**
 * Unit tests for the Smart Port-Forward rule-builder.
 */
import { describe, expect, test } from "vite-plus/test";
import { FORWARD_TAG, buildForwardRules } from "../../src/tools/port-forward";

describe("buildForwardRules", () => {
  test("builds dst-nat + forward-accept (no hairpin without lan_subnet)", () => {
    const rules = buildForwardRules({
      protocol: "tcp",
      externalPort: 443,
      internalHost: "192.168.1.10",
      internalPort: 8443,
    });
    expect(rules).toHaveLength(2);
    expect(rules[0].command).toContain("chain=dstnat");
    expect(rules[0].command).toContain("dst-port=443");
    expect(rules[0].command).toContain("to-addresses=192.168.1.10");
    expect(rules[0].command).toContain("to-ports=8443");
    expect(rules[1].command).toContain("chain=forward");
    expect(rules[1].command).toContain("action=accept");
    expect(rules.every((r) => r.command.includes(`comment="${FORWARD_TAG}:`))).toBe(true);
  });

  test("adds hairpin srcnat when a LAN subnet is given", () => {
    const rules = buildForwardRules({
      protocol: "tcp",
      externalPort: 443,
      internalHost: "192.168.1.10",
      internalPort: 443,
      lanSubnet: "192.168.1.0/24",
    });
    expect(rules).toHaveLength(3);
    const hairpin = rules[2].command;
    expect(hairpin).toContain("chain=srcnat");
    expect(hairpin).toContain("src-address=192.168.1.0/24");
    expect(hairpin).toContain("action=masquerade");
  });

  test("restricts to a WAN interface when provided", () => {
    const rules = buildForwardRules({
      protocol: "udp",
      externalPort: 51820,
      internalHost: "10.0.0.5",
      internalPort: 51820,
      wanInterface: "ether1",
    });
    expect(rules[0].command).toContain("in-interface=ether1");
    expect(rules[0].command).toContain("protocol=udp");
  });
});
