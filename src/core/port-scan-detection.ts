/**
 * Port-scan signature detection — pure catalog + planner, zero device I/O.
 *
 * Defines the six RouterOS `/ip firewall filter` port-scan detection signatures,
 * builds their exact commands, detects whether they are already present, and —
 * given already-fetched device state — plans the idempotent, lockout-safe write
 * sequence (validation → jump-gate positioning → per-signature create/skip). The
 * tool layer (`src/tools/port-scan-detection.ts`) does the fetching, snapshot and
 * Safe-Mode wrapping; this module is unit-tested without a live device.
 *
 * These signatures ONLY `add-src-to-address-list` — they detect and tag, they
 * never drop. Enforcement of the tagged list is deliberately out of scope.
 */
import { Cmd } from "./routeros";
import { findFinalUnconditionalDrop } from "./firewall-chain";
import type { FirewallRule } from "./firewall-audit";

/** The dedicated detection sub-chain all six signatures live in. */
export const DETECT_CHAIN = "detect-portscan";

/** Comment tagged on the single input→detect-portscan jump gate. */
export const JUMP_COMMENT = "detect-portscan jump";

export const PORT_SCAN_SIGNATURE_IDS = [
  "psd_generic",
  "nmap_fin_stealth",
  "syn_fin_scan",
  "syn_rst_scan",
  "fin_psh_urg_scan",
  "nmap_null_scan",
] as const;

export type PortScanSignatureId = (typeof PORT_SCAN_SIGNATURE_IDS)[number];

export interface PortScanSignature {
  id: PortScanSignatureId;
  /** Exactly the RouterOS `comment` written on the rule (idempotency key). */
  display_name: string;
  description: string;
  /**
   * The literal RouterOS match key→value for this signature — either a `psd` or
   * a `tcp-flags` condition. This is the exact syntax from the spec.
   */
  match: Record<string, string>;
}

export const PORT_SCAN_SIGNATURES: PortScanSignature[] = [
  {
    id: "psd_generic",
    display_name: "Port scanners to list",
    description:
      "RouterOS built-in Port Scan Detection (psd=21,3s,3,1): a source accrues weight touching " +
      "many ports fast (3 pts per privileged port <1024, 1 pt per high port) and trips at 21 within " +
      "3s. Catches ordinary nmap -sT/-sS sweeps that look like valid handshakes individually, which " +
      "the flag-based signatures cannot see.",
    match: { psd: "21,3s,3,1" },
  },
  {
    id: "nmap_fin_stealth",
    display_name: "NMAP FIN Stealth scan",
    description:
      "A lone FIN flag, everything else clear (tcp-flags=fin,!syn,!rst,!psh,!ack,!urg). No real " +
      "handshake or teardown starts with a bare FIN — Nmap's -sF technique to fingerprint port state " +
      "without completing a handshake and slip past SYN-only firewalls/IDS.",
    match: { "tcp-flags": "fin,!syn,!rst,!psh,!ack,!urg" },
  },
  {
    id: "syn_fin_scan",
    display_name: "SYN/FIN scan",
    description:
      "SYN and FIN set together (tcp-flags=fin,syn) — a logically impossible state (opening and " +
      "closing in one packet). Only a crafted scanning/fuzzing packet, historically used to bypass " +
      "firewalls that classified 'new' purely on SYN presence.",
    match: { "tcp-flags": "fin,syn" },
  },
  {
    id: "syn_rst_scan",
    display_name: "SYN/RST scan",
    description:
      "SYN and RST set together (tcp-flags=syn,rst) — open and abort never coexist in a real stack. " +
      "An unambiguous signature of a hand-built probing packet.",
    match: { "tcp-flags": "syn,rst" },
  },
  {
    id: "fin_psh_urg_scan",
    display_name: "FIN/PSH/URG scan",
    description:
      "Nmap's -sX 'Xmas tree' scan (tcp-flags=fin,psh,urg,!syn,!rst,!ack) — three flags lit. Same " +
      "open/closed inference as the FIN scan, an alternate fingerprint against stacks that special-" +
      "case the plain FIN pattern.",
    match: { "tcp-flags": "fin,psh,urg,!syn,!rst,!ack" },
  },
  {
    id: "nmap_null_scan",
    display_name: "NMAP NULL scan",
    description:
      "Nmap's -sN scan — an empty TCP flag byte (tcp-flags=!fin,!syn,!rst,!psh,!ack,!urg). Same " +
      "stealth/fingerprint purpose as FIN and Xmas, using the complete absence of flags.",
    match: { "tcp-flags": "!fin,!syn,!rst,!psh,!ack,!urg" },
  },
];

const SIGNATURE_BY_ID = new Map(PORT_SCAN_SIGNATURES.map((s) => [s.id, s]));

/** True when `id` is one of the six known signature IDs. */
export function isSignatureId(id: string): id is PortScanSignatureId {
  return SIGNATURE_BY_ID.has(id as PortScanSignatureId);
}

/** The single match condition rendered as `key=value` for display. */
export function routerosMatch(sig: PortScanSignature): string {
  return Object.entries(sig.match)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

/** Build the `/ip firewall filter add` command for one signature. */
export function buildSignatureCommand(
  sig: PortScanSignature,
  addressList: string,
  timeout: string,
): string {
  const cmd = new Cmd("/ip firewall filter add")
    .set("chain", DETECT_CHAIN)
    .set("action", "add-src-to-address-list")
    .set("protocol", "tcp");
  for (const [k, v] of Object.entries(sig.match)) cmd.set(k, v);
  return cmd
    .set("address-list", addressList)
    .set("address-list-timeout", timeout)
    .set("comment", sig.display_name)
    .build();
}

/**
 * Build the single input→detect-portscan jump gate. The trust exclusion lives
 * here and ONLY here (negative match), so a trusted source never enters the
 * detection chain and can never be tagged. `placeBefore` is a RouterOS `.id`
 * token (e.g. `*A`) resolved by the caller for the default-deny rule; omit to
 * append. (A chain-filtered `print` renumbers rows, so the caller must pass an
 * `.id`, never the filtered ordinal.)
 */
export function buildJumpCommand(trustedList: string, placeBefore?: string): string {
  return new Cmd("/ip firewall filter add")
    .set("chain", "input")
    .set("action", "jump")
    .set("jump-target", DETECT_CHAIN)
    .set("src-address-list", `!${trustedList}`)
    .set("comment", JUMP_COMMENT)
    .opt("place-before", placeBefore)
    .build();
}

/**
 * Is a signature already present in the detect-portscan chain? Keyed on the
 * comment (the display name) AND the actual match value (psd / tcp-flags), so a
 * stray rule with the same comment but different match is not mistaken for it.
 */
export function signaturePresent(
  detectChainRules: FirewallRule[],
  sig: PortScanSignature,
): boolean {
  const [matchKey, matchVal] = Object.entries(sig.match)[0];
  return detectChainRules.some(
    (r) =>
      r.comment === sig.display_name &&
      r.action === "add-src-to-address-list" &&
      (r.match[matchKey] ?? "") === matchVal,
  );
}

/** Is the input→detect-portscan jump gate already present? */
export function jumpRulePresent(inputRules: FirewallRule[]): boolean {
  return inputRules.some(
    (r) => r.action === "jump" && (r.raw["jump-target"] ?? "") === DETECT_CHAIN,
  );
}

// ── Planner ─────────────────────────────────────────────────────────────────

export interface DeviceScanState {
  /** Parsed `chain=input` rules, in order. */
  inputRules: FirewallRule[];
  /** Parsed `chain=detect-portscan` rules, in order (empty when the chain is absent). */
  detectChainRules: FirewallRule[];
  /** Whether the named trusted list is defined on the device (has ≥0 entries). */
  trustListExists: boolean;
  /** Number of entries currently in the trusted list. */
  trustListCount: number;
}

export interface PlanArgs {
  ruleTypes: string[];
  trustedListName: string;
  addressListName: string;
  addressListTimeout: string;
  confirm: boolean;
  confirmedTrustedListIncludesMyIp: boolean;
}

export interface SignaturePlan {
  id: PortScanSignatureId;
  display_name: string;
  status: "create" | "already_present";
  /** The command to run when status is "create". */
  command?: string;
  routeros_match: string;
}

export interface PortScanPlan {
  /** Set when the request is rejected pre-flight — NO writes should occur. */
  error?: string;
  chainName: string;
  /** True when the detect-portscan chain already had rules. */
  chainPreexisted: boolean;
  jump: {
    present: boolean;
    /**
     * ARRAY position (0-based) of the default-deny within `inputRules`, or null
     * to append. The handler maps this position to the rule's `.id` (via the
     * ordered `find chain=input` id list) for a correct `place-before` — the
     * chain-filtered print `#` cannot be used directly.
     */
    placeBeforeIndex: number | null;
  };
  signatures: SignaturePlan[];
  /** The default-deny rule's printed `#` in the input chain, or null if none (display only). */
  defaultDenyIndex: number | null;
  missingDefaultDeny: boolean;
  /** Signature `add` commands to run (not-yet-present only). The jump is built by the handler. */
  signatureCommands: string[];
}

/**
 * Validate the request and, if it passes, compute the full idempotent write plan
 * from already-fetched device state. Pure: returns `{ error }` for any rejection
 * (the tool must then perform NO writes), otherwise the plan. Validation runs
 * BEFORE anything else so the caller can guarantee no snapshot/Safe-Mode/write on
 * a rejected call.
 */
export function planPortScanDetection(state: DeviceScanState, args: PlanArgs): PortScanPlan {
  const base: PortScanPlan = {
    chainName: DETECT_CHAIN,
    chainPreexisted: state.detectChainRules.length > 0,
    jump: { present: false, placeBeforeIndex: null },
    signatures: [],
    defaultDenyIndex: null,
    missingDefaultDeny: true,
    signatureCommands: [],
  };

  // 1. rule_types: required, non-empty, no "all" shortcut, only known IDs.
  if (!Array.isArray(args.ruleTypes) || args.ruleTypes.length === 0) {
    return {
      ...base,
      error:
        "rule_types is required and must be a non-empty array. Call " +
        "list_port_scan_detection_signatures first, show the user all six signatures, and pass " +
        "only the specific signature IDs the user explicitly chose. There is no select-all shortcut.",
    };
  }
  // Any value that isn't one of the six IDs is rejected — this also covers an
  // "all"/select-all shortcut, which is deliberately not a valid value.
  const unknown = args.ruleTypes.filter((t) => !isSignatureId(t));
  if (unknown.length > 0) {
    return {
      ...base,
      error:
        `Unknown or disallowed rule_types: ${unknown.join(", ")}. Valid IDs: ` +
        `${PORT_SCAN_SIGNATURE_IDS.join(", ")}. There is no "all" value — name specific signatures.`,
    };
  }

  // 2. Human acknowledgement + confirm gate.
  if (args.confirm !== true) {
    return {
      ...base,
      error: "confirm must be true to write. This tool never runs on a guessed selection.",
    };
  }
  if (args.confirmedTrustedListIncludesMyIp !== true) {
    return {
      ...base,
      error:
        "confirmed_trusted_list_includes_my_ip must be true. The human must first acknowledge that " +
        `the address they manage this device from is present in '${args.trustedListName}' — the tool ` +
        "cannot know which IP you connect from, so it cannot infer this.",
    };
  }

  // 3. Trust list must exist AND be non-empty (an empty trust list protects nothing).
  if (!state.trustListExists) {
    return {
      ...base,
      error:
        `Trusted list '${args.trustedListName}' does not exist on this device. Create and populate ` +
        "it with your management address(es) first — this tool will not auto-create it.",
    };
  }
  if (state.trustListCount <= 0) {
    return {
      ...base,
      error:
        `Trusted list '${args.trustedListName}' exists but is EMPTY. An empty trust list means the ` +
        "jump-gate exclusion protects nothing; populate it with your management address(es) first.",
    };
  }

  // ── Passed validation → build the plan ────────────────────────────────────
  const defaultDeny = findFinalUnconditionalDrop(state.inputRules);
  const missingDefaultDeny = defaultDeny === null;
  // Array position aligns with the ordered `find chain=input` id list the handler
  // fetches; the printed `#` is kept only for human-readable reporting.
  const placeBeforeIndex = defaultDeny ? state.inputRules.indexOf(defaultDeny) : null;

  const signatures: SignaturePlan[] = args.ruleTypes.map((id) => {
    const sig = SIGNATURE_BY_ID.get(id as PortScanSignatureId)!;
    const present = signaturePresent(state.detectChainRules, sig);
    return {
      id: sig.id,
      display_name: sig.display_name,
      status: present ? "already_present" : "create",
      command: present
        ? undefined
        : buildSignatureCommand(sig, args.addressListName, args.addressListTimeout),
      routeros_match: routerosMatch(sig),
    };
  });

  return {
    chainName: DETECT_CHAIN,
    chainPreexisted: state.detectChainRules.length > 0,
    jump: { present: jumpRulePresent(state.inputRules), placeBeforeIndex },
    signatures,
    defaultDenyIndex: defaultDeny ? defaultDeny.index : null,
    missingDefaultDeny,
    signatureCommands: signatures.filter((s) => s.status === "create").map((s) => s.command!),
  };
}
