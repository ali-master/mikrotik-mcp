/**
 * Unit tests for the pure port-scan detection engine (catalog + planner + the
 * shared chain-drop finder). No device I/O — every fixture is realistic RouterOS
 * `print detail` text parsed exactly as the tool layer parses it, or a hand-built
 * DeviceScanState.
 *
 * The rejection cases double as the guarantee that a bad request performs NO
 * writes: the planner returns `{ error }` with an empty command set BEFORE any
 * snapshot / Safe-Mode / write path in the tool layer can run.
 */
import { describe, expect, test } from "vite-plus/test";
import { rulesFromRows } from "../../src/core/firewall-audit";
import type { FirewallRule } from "../../src/core/firewall-audit";
import { findFinalUnconditionalDrop, ruleMatchesAll } from "../../src/core/firewall-chain";
import { parseRecords } from "../../src/core/routeros-parse";
import {
  DETECT_CHAIN,
  PORT_SCAN_SIGNATURES,
  buildJumpCommand,
  buildSignatureCommand,
  jumpRulePresent,
  planPortScanDetection,
  signaturePresent,
} from "../../src/core/port-scan-detection";
import type {
  DeviceScanState,
  PlanArgs,
  PortScanSignatureId,
} from "../../src/core/port-scan-detection";

// ── Fixture helpers ─────────────────────────────────────────────────────────

function fw(text: string): FirewallRule[] {
  return rulesFromRows(parseRecords(text).rows);
}

/** Build detect-portscan chain rows for a set of signatures (as if already installed). */
function detectChainWith(ids: PortScanSignatureId[]): FirewallRule[] {
  const rows = ids.map((id, i) => {
    const s = PORT_SCAN_SIGNATURES.find((x) => x.id === id)!;
    const match = Object.entries(s.match)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    return (
      ` ${i}    ;;; ${s.display_name}\n` +
      `      chain=detect-portscan action=add-src-to-address-list protocol=tcp ${match} ` +
      `address-list="port scanners" address-list-timeout=2w`
    );
  });
  return fw(`Flags: X - disabled, D - dynamic\n${rows.join("\n")}`);
}

const ALL_IDS: PortScanSignatureId[] = [
  "psd_generic",
  "nmap_fin_stealth",
  "syn_fin_scan",
  "syn_rst_scan",
  "fin_psh_urg_scan",
  "nmap_null_scan",
];

function args(ruleTypes: string[], over: Partial<PlanArgs> = {}): PlanArgs {
  return {
    ruleTypes,
    trustedListName: "Trust-IP",
    addressListName: "port scanners",
    addressListTimeout: "2w",
    confirm: true,
    confirmedTrustedListIncludesMyIp: true,
    ...over,
  };
}

function state(over: Partial<DeviceScanState> = {}): DeviceScanState {
  return {
    inputRules: [],
    detectChainRules: [],
    trustListExists: true,
    trustListCount: 3,
    ...over,
  };
}

// Input chains with and without a default-deny.
const INPUT_WITH_DEFAULT_DENY = fw(`
 0    chain=input action=accept protocol=tcp dst-port=22 src-address-list=Trust-IP
 1    chain=input action=accept connection-state=established,related,untracked
 2    chain=input action=drop
`);
const INPUT_NO_DEFAULT_DENY = fw(`
 0    chain=input action=accept protocol=tcp dst-port=22 src-address-list=Trust-IP
 1    chain=input action=accept connection-state=established,related,untracked
`);

// ── Rejection / validation (proves no-write path) ───────────────────────────

describe("planPortScanDetection — pre-flight rejection", () => {
  test("rejects an empty rule_types array and plans no commands", () => {
    const plan = planPortScanDetection(state(), args([]));
    expect(plan.error).toMatch(/non-empty/i);
    expect(plan.signatureCommands).toHaveLength(0);
  });

  test("rejects an unknown signature id (including an 'all' shortcut)", () => {
    const plan = planPortScanDetection(state(), args(["all"]));
    expect(plan.error).toMatch(/Unknown or disallowed/i);
    expect(plan.error).toMatch(/no "all" value/i);
  });

  test("rejects when the trusted list does not exist on the device", () => {
    const plan = planPortScanDetection(
      state({ trustListExists: false, trustListCount: 0 }),
      args(["psd_generic"]),
    );
    expect(plan.error).toMatch(/does not exist/i);
    expect(plan.signatureCommands).toHaveLength(0);
  });

  test("rejects when the trusted list exists but is empty", () => {
    const plan = planPortScanDetection(
      state({ trustListExists: true, trustListCount: 0 }),
      args(["psd_generic"]),
    );
    expect(plan.error).toMatch(/EMPTY/);
  });

  test("rejects when confirmed_trusted_list_includes_my_ip is not true", () => {
    const plan = planPortScanDetection(
      state(),
      args(["psd_generic"], { confirmedTrustedListIncludesMyIp: false }),
    );
    expect(plan.error).toMatch(/confirmed_trusted_list_includes_my_ip/);
    expect(plan.signatureCommands).toHaveLength(0);
  });

  test("rejects when confirm is not true", () => {
    const plan = planPortScanDetection(state(), args(["psd_generic"], { confirm: false }));
    expect(plan.error).toMatch(/confirm must be true/i);
  });
});

// ── Jump-gate positioning ───────────────────────────────────────────────────

describe("planPortScanDetection — jump-gate positioning", () => {
  test("places the jump before an existing input default-deny (its array position)", () => {
    const plan = planPortScanDetection(
      state({ inputRules: INPUT_WITH_DEFAULT_DENY }),
      args(["psd_generic"]),
    );
    expect(plan.error).toBeUndefined();
    expect(plan.jump.placeBeforeIndex).toBe(2); // the drop is the 3rd input rule
    expect(plan.defaultDenyIndex).toBe(2);
    expect(plan.missingDefaultDeny).toBe(false);
  });

  test("appends the jump after management accepts when no default-deny exists", () => {
    const plan = planPortScanDetection(
      state({ inputRules: INPUT_NO_DEFAULT_DENY }),
      args(["psd_generic"]),
    );
    expect(plan.jump.placeBeforeIndex).toBeNull();
    expect(plan.missingDefaultDeny).toBe(true);
    expect(plan.defaultDenyIndex).toBeNull();
  });

  test("reports the jump as already present when an input jump to detect-portscan exists", () => {
    const input = fw(`
 0    chain=input action=accept connection-state=established,related
 1    chain=input action=jump jump-target=detect-portscan src-address-list=!Trust-IP
 2    chain=input action=drop
`);
    const plan = planPortScanDetection(state({ inputRules: input }), args(["psd_generic"]));
    expect(plan.jump.present).toBe(true);
  });
});

// ── Idempotency ─────────────────────────────────────────────────────────────

describe("planPortScanDetection — idempotency", () => {
  test("a second run with the same six signatures already present creates nothing", () => {
    const plan = planPortScanDetection(
      state({ detectChainRules: detectChainWith(ALL_IDS) }),
      args(ALL_IDS),
    );
    expect(plan.signatureCommands).toHaveLength(0);
    expect(plan.signatures.every((s) => s.status === "already_present")).toBe(true);
  });

  test("with three of six already present, only the three missing ones are created", () => {
    const already: PortScanSignatureId[] = ["psd_generic", "syn_fin_scan", "nmap_null_scan"];
    const plan = planPortScanDetection(
      state({ detectChainRules: detectChainWith(already) }),
      args(ALL_IDS),
    );
    const created = plan.signatures.filter((s) => s.status === "create").map((s) => s.id);
    const present = plan.signatures.filter((s) => s.status === "already_present").map((s) => s.id);
    expect(created.sort()).toEqual(["fin_psh_urg_scan", "nmap_fin_stealth", "syn_rst_scan"]);
    expect(present.sort()).toEqual([...already].sort());
    expect(plan.signatureCommands).toHaveLength(3);
    expect(plan.signatures).toHaveLength(6); // all six reported
  });
});

// ── Chain creation vs reuse ─────────────────────────────────────────────────

describe("planPortScanDetection — chain creation vs reuse", () => {
  test("reports the detect-portscan chain as newly created when it has no rules yet", () => {
    const plan = planPortScanDetection(state({ detectChainRules: [] }), args(["psd_generic"]));
    expect(plan.chainPreexisted).toBe(false);
  });

  test("reports the detect-portscan chain as reused when it already has a signature", () => {
    const plan = planPortScanDetection(
      state({ detectChainRules: detectChainWith(["nmap_null_scan"]) }),
      args(["psd_generic"]),
    );
    expect(plan.chainPreexisted).toBe(true);
  });
});

// ── Exact signature syntax (one per signature) ──────────────────────────────

describe("buildSignatureCommand — exact RouterOS match syntax per signature", () => {
  const common = (cmd: string): void => {
    expect(cmd).toContain(`chain=${DETECT_CHAIN}`);
    expect(cmd).toContain("action=add-src-to-address-list");
    expect(cmd).toContain("protocol=tcp");
    expect(cmd).toContain('address-list="port scanners"');
    expect(cmd).toContain("address-list-timeout=2w");
  };

  test("psd_generic uses psd=21,3s,3,1 and the 'Port scanners to list' comment", () => {
    const cmd = buildSignatureCommand(PORT_SCAN_SIGNATURES[0], "port scanners", "2w");
    common(cmd);
    expect(cmd).toContain("psd=21,3s,3,1");
    expect(cmd).toContain('comment="Port scanners to list"');
  });

  test("nmap_fin_stealth uses tcp-flags=fin,!syn,!rst,!psh,!ack,!urg", () => {
    const cmd = buildSignatureCommand(PORT_SCAN_SIGNATURES[1], "port scanners", "2w");
    common(cmd);
    expect(cmd).toContain("tcp-flags=fin,!syn,!rst,!psh,!ack,!urg");
    expect(cmd).toContain('comment="NMAP FIN Stealth scan"');
  });

  test("syn_fin_scan uses tcp-flags=fin,syn", () => {
    const cmd = buildSignatureCommand(PORT_SCAN_SIGNATURES[2], "port scanners", "2w");
    common(cmd);
    expect(cmd).toContain("tcp-flags=fin,syn");
    expect(cmd).toContain('comment="SYN/FIN scan"');
  });

  test("syn_rst_scan uses tcp-flags=syn,rst", () => {
    const cmd = buildSignatureCommand(PORT_SCAN_SIGNATURES[3], "port scanners", "2w");
    common(cmd);
    expect(cmd).toContain("tcp-flags=syn,rst");
    expect(cmd).toContain('comment="SYN/RST scan"');
  });

  test("fin_psh_urg_scan (Xmas) uses tcp-flags=fin,psh,urg,!syn,!rst,!ack", () => {
    const cmd = buildSignatureCommand(PORT_SCAN_SIGNATURES[4], "port scanners", "2w");
    common(cmd);
    expect(cmd).toContain("tcp-flags=fin,psh,urg,!syn,!rst,!ack");
    expect(cmd).toContain('comment="FIN/PSH/URG scan"');
  });

  test("nmap_null_scan uses tcp-flags=!fin,!syn,!rst,!psh,!ack,!urg", () => {
    const cmd = buildSignatureCommand(PORT_SCAN_SIGNATURES[5], "port scanners", "2w");
    common(cmd);
    expect(cmd).toContain("tcp-flags=!fin,!syn,!rst,!psh,!ack,!urg");
    expect(cmd).toContain('comment="NMAP NULL scan"');
  });

  test("honours a custom address list name and timeout", () => {
    const cmd = buildSignatureCommand(PORT_SCAN_SIGNATURES[0], "scanners-2", "1d");
    expect(cmd).toContain("address-list=scanners-2");
    expect(cmd).toContain("address-list-timeout=1d");
  });
});

// ── Jump command builder ────────────────────────────────────────────────────

describe("buildJumpCommand", () => {
  test("expresses the trust exclusion as a negative src-address-list on the jump", () => {
    const cmd = buildJumpCommand("Trust-IP");
    expect(cmd).toContain("chain=input");
    expect(cmd).toContain("action=jump");
    expect(cmd).toContain(`jump-target=${DETECT_CHAIN}`);
    expect(cmd).toContain("src-address-list=!Trust-IP");
    expect(cmd).not.toContain("place-before");
  });

  test("anchors the jump before a given default-deny .id when supplied", () => {
    const cmd = buildJumpCommand("Trust-IP", "*A");
    expect(cmd).toContain("place-before=*A");
  });
});

// ── Shared chain-drop finder ────────────────────────────────────────────────

describe("findFinalUnconditionalDrop / ruleMatchesAll", () => {
  test("treats an unconditional drop as matching all traffic", () => {
    const [r] = fw(` 0  chain=input action=drop`);
    expect(ruleMatchesAll(r)).toBe(true);
  });

  test("does not treat a port-scoped drop as matching all", () => {
    const [r] = fw(` 0  chain=input action=drop protocol=tcp dst-port=22`);
    expect(ruleMatchesAll(r)).toBe(false);
  });

  test("returns the last unconditional drop/reject in the chain", () => {
    const found = findFinalUnconditionalDrop(INPUT_WITH_DEFAULT_DENY);
    expect(found?.index).toBe(2);
  });

  test("returns null when the chain has no unconditional drop", () => {
    expect(findFinalUnconditionalDrop(INPUT_NO_DEFAULT_DENY)).toBeNull();
  });

  test("ignores a disabled catch-all drop when finding the default-deny", () => {
    const rules = fw(`
Flags: X - disabled
 0    chain=input action=accept
 1 X  chain=input action=drop
`);
    expect(findFinalUnconditionalDrop(rules)).toBeNull();
  });
});

// ── Presence detectors ──────────────────────────────────────────────────────

describe("signaturePresent / jumpRulePresent", () => {
  test("matches a signature by comment AND its match value together", () => {
    const rules = detectChainWith(["syn_fin_scan"]);
    expect(signaturePresent(rules, PORT_SCAN_SIGNATURES[2])).toBe(true); // syn_fin_scan
    expect(signaturePresent(rules, PORT_SCAN_SIGNATURES[3])).toBe(false); // syn_rst_scan
  });

  test("does not match a rule that shares the comment but has a different match", () => {
    const rows = fw(`
 0    ;;; SYN/FIN scan
      chain=detect-portscan action=add-src-to-address-list protocol=tcp tcp-flags=syn,rst address-list="port scanners"
`);
    // comment says SYN/FIN but tcp-flags are syn,rst — must NOT count as syn_fin_scan present.
    expect(signaturePresent(rows, PORT_SCAN_SIGNATURES[2])).toBe(false);
  });

  test("detects an existing input jump to detect-portscan", () => {
    const rules = fw(
      ` 0  chain=input action=jump jump-target=detect-portscan src-address-list=!Trust-IP`,
    );
    expect(jumpRulePresent(rules)).toBe(true);
  });

  test("reports no jump when none targets detect-portscan", () => {
    expect(jumpRulePresent(INPUT_WITH_DEFAULT_DENY)).toBe(false);
  });
});
