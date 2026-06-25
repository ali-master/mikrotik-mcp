/**
 * Smart Port-Forward Wizard — expose an internal service safely and completely:
 * the DST-NAT rule, the matching forward-accept (so it passes a default-drop),
 * AND the hairpin/loopback srcnat (so the service also works when reached from
 * inside the LAN via the public IP). Previewable before applying.
 *
 * The pure `buildForwardRules` is unit-tested; the tool wires apply/preview.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { DANGEROUS, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { Cmd, looksLikeError } from "../core/routeros";

export const FORWARD_TAG = "port-forward";

export interface ForwardOptions {
  protocol: "tcp" | "udp";
  externalPort: number;
  internalHost: string;
  internalPort: number;
  wanInterface?: string;
  /** LAN subnet for hairpin NAT; omit to skip loopback support. */
  lanSubnet?: string;
  comment?: string;
}

/** Build the dst-nat + forward-accept + optional hairpin srcnat for a forward. */
export function buildForwardRules(o: ForwardOptions): { label: string; command: string }[] {
  const tag = o.comment
    ? `${FORWARD_TAG}: ${o.comment}`
    : `${FORWARD_TAG}: ${o.externalPort}→${o.internalHost}:${o.internalPort}`;
  const rules: { label: string; command: string }[] = [];

  const dstnat = new Cmd("/ip firewall nat add")
    .set("chain", "dstnat")
    .set("protocol", o.protocol)
    .set("dst-port", o.externalPort)
    .set("action", "dst-nat")
    .set("to-addresses", o.internalHost)
    .set("to-ports", o.internalPort);
  if (o.wanInterface) dstnat.set("in-interface", o.wanInterface);
  rules.push({ label: "DST-NAT (forward the port)", command: dstnat.set("comment", tag).build() });

  rules.push({
    label: "Forward accept (allow through a default-drop)",
    command: new Cmd("/ip firewall filter add")
      .set("chain", "forward")
      .set("protocol", o.protocol)
      .set("dst-address", o.internalHost)
      .set("dst-port", o.internalPort)
      .set("action", "accept")
      .set("comment", tag)
      .build(),
  });

  if (o.lanSubnet) {
    rules.push({
      label: "Hairpin NAT (reach the service from inside the LAN)",
      command: new Cmd("/ip firewall nat add")
        .set("chain", "srcnat")
        .set("protocol", o.protocol)
        .set("src-address", o.lanSubnet)
        .set("dst-address", o.internalHost)
        .set("dst-port", o.internalPort)
        .set("action", "masquerade")
        .set("comment", `${tag} hairpin`)
        .build(),
    });
  }
  return rules;
}

export const portForwardTools: ToolModule = [
  defineTool({
    name: "forward_port",
    title: "Forward a Port (Smart Wizard)",
    annotations: DANGEROUS,
    description:
      "Exposes an internal service correctly and completely in one call: the DST-NAT rule that " +
      "forwards `external_port` to `internal_host:internal_port`, the matching forward-chain accept " +
      "(so it passes a default-drop firewall), and — when `lan_subnet` is given — the hairpin/loopback " +
      "srcnat so the service also works when reached from inside the LAN via the public IP. DEFAULTS " +
      "TO A DRY RUN (`apply=false`) showing every rule; set `apply=true` to create them. All rules are " +
      "tagged 'port-forward:'. Returns the plan or a build report.",
    inputSchema: {
      protocol: z.enum(["tcp", "udp"]).default("tcp"),
      external_port: z.number().int().min(1).max(65535),
      internal_host: z.string().describe("LAN IP of the service, e.g. '192.168.1.10'"),
      internal_port: z
        .number()
        .int()
        .min(1)
        .max(65535)
        .optional()
        .describe("Defaults to external_port"),
      wan_interface: z.string().optional().describe("Restrict the forward to this WAN interface"),
      lan_subnet: z
        .string()
        .optional()
        .describe("LAN subnet for hairpin NAT, e.g. '192.168.1.0/24'"),
      comment: z.string().optional(),
      apply: z.boolean().default(false).describe("false = preview (default); true = create"),
    },
    async handler(a, ctx) {
      const rules = buildForwardRules({
        protocol: a.protocol,
        externalPort: a.external_port,
        internalHost: a.internal_host,
        internalPort: a.internal_port ?? a.external_port,
        wanInterface: a.wan_interface,
        lanSubnet: a.lan_subnet,
        comment: a.comment,
      });
      if (!a.apply) {
        const plan = rules.map((r, i) => `${i + 1}. ${r.label}\n   ${r.command}`).join("\n");
        return `DRY RUN — forward ${a.protocol}/${a.external_port} → ${a.internal_host}:${a.internal_port ?? a.external_port}; ${rules.length} rule(s) (set apply=true to create):\n\n${plan}${a.lan_subnet ? "" : "\n\n(Tip: pass lan_subnet to also add hairpin NAT for LAN access via the public IP.)"}`;
      }
      const done: string[] = [];
      for (const r of rules) {
        const result = await executeMikrotikCommand(r.command, ctx);
        if (looksLikeError(result)) {
          return `Created ${done.length}/${rules.length} rules, then FAILED: ${result}\nReview partial forward.`;
        }
        done.push(r.label);
      }
      return `Port forward created — ${done.length} rule(s): ${done.join(", ")}.`;
    },
  }),
];
