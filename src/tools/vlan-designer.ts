/**
 * VLAN Segmentation Designer — stand up a complete, isolated network segment
 * from one intent: the VLAN interface, its IP/gateway, a DHCP server + pool,
 * optional internet (srcnat masquerade), and inter-VLAN isolation firewall rules
 * — wired together and previewable before applying. Composes the existing
 * vlan/bridge/dhcp/firewall building blocks rather than duplicating them.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { DANGEROUS, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { Cmd, looksLikeError } from "../core/routeros";

/** A sensible default DHCP range (.10–.254) for a /24-style subnet. */
function defaultRange(subnet: string): string {
  const o = subnet.split("/")[0].split(".");
  return `${o[0]}.${o[1]}.${o[2]}.10-${o[0]}.${o[1]}.${o[2]}.254`;
}

export const vlanDesignerTools: ToolModule = [
  defineTool({
    name: "design_network_segment",
    title: "Design Isolated VLAN Segment",
    annotations: DANGEROUS,
    description:
      "Stands up a complete isolated network segment in one call: a VLAN interface on the bridge, its " +
      "gateway IP, a DHCP server + pool + network, optional internet access (srcnat masquerade), and " +
      "inter-VLAN isolation firewall rules — e.g. 'a guest VLAN that reaches the internet but not the " +
      "LAN'. DEFAULTS TO A DRY RUN (`apply=false`) showing every command grouped; set `apply=true` to " +
      "build it. Bridge VLAN tagging is added when `tagged_ports`/`untagged_ports` are given (requires " +
      "bridge vlan-filtering). Isolation drops forward traffic from this subnet to each `isolate_from` " +
      "subnet. Returns the plan or a build report.",
    inputSchema: {
      vlan_id: z.number().int().min(1).max(4094),
      name: z.string().describe("Name for the VLAN interface, e.g. 'guest'"),
      subnet: z.string().describe("CIDR for the segment, e.g. '192.168.30.0/24'"),
      gateway: z.string().describe("Router's address in the segment, e.g. '192.168.30.1'"),
      bridge: z.string().default("bridge").describe("Bridge to put the VLAN on"),
      tagged_ports: z
        .string()
        .optional()
        .describe("Comma-separated trunk/tagged ports (+ the bridge)"),
      untagged_ports: z.string().optional().describe("Comma-separated access/untagged ports"),
      dhcp: z.boolean().default(true).describe("Create a DHCP server + pool for the segment"),
      dhcp_range: z.string().optional().describe("Pool range; defaults to .10–.254 of the subnet"),
      internet: z.boolean().default(true).describe("Allow internet access via srcnat masquerade"),
      isolate_from: z
        .array(z.string())
        .optional()
        .describe("Subnets this segment must NOT reach, e.g. ['192.168.1.0/24']"),
      apply: z.boolean().default(false).describe("false = preview (default); true = build"),
    },
    async handler(a, ctx) {
      const prefix = a.subnet.split("/")[1] ?? "24";
      const vlanIf = a.name;
      const groups: { label: string; commands: string[] }[] = [];

      groups.push({
        label: "VLAN interface + gateway",
        commands: [
          new Cmd("/interface vlan add")
            .set("name", vlanIf)
            .set("vlan-id", a.vlan_id)
            .set("interface", a.bridge)
            .build(),
          new Cmd("/ip address add")
            .set("address", `${a.gateway}/${prefix}`)
            .set("interface", vlanIf)
            .build(),
        ],
      });

      if (a.tagged_ports || a.untagged_ports) {
        groups.push({
          label: "Bridge VLAN tagging",
          commands: [
            new Cmd("/interface bridge vlan add")
              .set("bridge", a.bridge)
              .set("vlan-ids", a.vlan_id)
              .opt("tagged", a.tagged_ports ? `${a.bridge},${a.tagged_ports}` : a.bridge)
              .opt("untagged", a.untagged_ports)
              .build(),
          ],
        });
      }

      if (a.dhcp) {
        const pool = `${a.name}-pool`;
        groups.push({
          label: "DHCP server",
          commands: [
            new Cmd("/ip pool add")
              .set("name", pool)
              .set("ranges", a.dhcp_range ?? defaultRange(a.subnet))
              .build(),
            new Cmd("/ip dhcp-server add")
              .set("name", `${a.name}-dhcp`)
              .set("interface", vlanIf)
              .set("address-pool", pool)
              .set("disabled", "no")
              .build(),
            new Cmd("/ip dhcp-server network add")
              .set("address", a.subnet)
              .set("gateway", a.gateway)
              .set("dns-server", a.gateway)
              .build(),
          ],
        });
      }

      if (a.internet) {
        groups.push({
          label: "Internet (srcnat masquerade)",
          commands: [
            new Cmd("/ip firewall nat add")
              .set("chain", "srcnat")
              .set("src-address", a.subnet)
              .set("action", "masquerade")
              .set("comment", `vlan-${a.vlan_id} internet`)
              .build(),
          ],
        });
      }

      const isolate = (a.isolate_from ?? []) as string[];
      if (isolate.length) {
        groups.push({
          label: "Inter-VLAN isolation",
          commands: isolate.map((dst) =>
            new Cmd("/ip firewall filter add")
              .set("chain", "forward")
              .set("src-address", a.subnet)
              .set("dst-address", dst)
              .set("action", "drop")
              .set("comment", `vlan-${a.vlan_id} isolate from ${dst}`)
              .build(),
          ),
        });
      }

      const all = groups.flatMap((g) => g.commands);
      if (!a.apply) {
        const preview = groups
          .map((g) => `# ${g.label}\n${g.commands.map((c) => `  ${c}`).join("\n")}`)
          .join("\n\n");
        return `DRY RUN — VLAN ${a.vlan_id} '${a.name}' (${a.subnet}); ${all.length} command(s) (set apply=true to build):\n\n${preview}`;
      }

      const done: string[] = [];
      for (const cmd of all) {
        const result = await executeMikrotikCommand(cmd, ctx);
        if (looksLikeError(result)) {
          return `Built ${done.length}/${all.length} commands, then FAILED: ${result}\nReview partial segment (the VLAN may exist without DHCP/firewall).`;
        }
        done.push(cmd);
      }
      return `VLAN segment '${a.name}' (id ${a.vlan_id}, ${a.subnet}) built — ${done.length} command(s)${isolate.length ? `, isolated from ${isolate.join(", ")}` : ""}.`;
    },
  }),
];
