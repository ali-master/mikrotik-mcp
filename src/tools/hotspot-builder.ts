/**
 * Captive Portal Builder — stand up a guest Wi-Fi hotspot with a sign-in portal
 * from one intent: the IP gateway, address pool, DHCP, the `/ip hotspot` server +
 * profile (with a per-guest bandwidth cap and DNS name), and a walled garden
 * (sites reachable before sign-in). Plus a voucher generator for printable
 * guest codes. Previewable before applying.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, DANGEROUS, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { Cmd, looksLikeError } from "../core/routeros";

function defaultRange(subnet: string): string {
  const o = subnet.split("/")[0].split(".");
  return `${o[0]}.${o[1]}.${o[2]}.10-${o[0]}.${o[1]}.${o[2]}.254`;
}

export const hotspotBuilderTools: ToolModule = [
  defineTool({
    name: "build_guest_hotspot",
    title: "Build Guest Hotspot (Captive Portal)",
    annotations: DANGEROUS,
    description:
      "Stands up a guest hotspot with a captive sign-in portal in one call: the gateway IP, an address " +
      "pool, a DHCP server, the `/ip hotspot` server + profile (with a per-guest `rate_limit` bandwidth " +
      "cap and optional `dns_name`), and a walled garden (the `walled_garden` domains reachable BEFORE " +
      "sign-in, e.g. your payment/login pages). DEFAULTS TO A DRY RUN (`apply=false`) showing every " +
      "command; set `apply=true` to build it. Generate printable guest codes with " +
      "generate_hotspot_vouchers. Returns the plan or a build report.",
    inputSchema: {
      interface: z.string().describe("Interface/bridge the hotspot runs on, e.g. 'guest-bridge'"),
      subnet: z.string().default("10.5.50.0/24").describe("Hotspot subnet"),
      gateway: z.string().default("10.5.50.1").describe("Router address in the hotspot subnet"),
      pool_range: z.string().optional().describe("DHCP/hotspot pool; defaults to .10–.254"),
      dns_name: z.string().optional().describe("Captive-portal hostname, e.g. 'guest.wifi'"),
      rate_limit: z.string().default("5M/5M").describe("Per-guest max-limit (rx/tx)"),
      walled_garden: z
        .array(z.string())
        .optional()
        .describe("Domains reachable before sign-in, e.g. ['*.stripe.com']"),
      apply: z.boolean().default(false).describe("false = preview (default); true = build"),
    },
    async handler(a, ctx) {
      const prefix = a.subnet.split("/")[1] ?? "24";
      const range = a.pool_range ?? defaultRange(a.subnet);
      const pool = `hs-${a.interface}-pool`;
      const profile = `hs-${a.interface}`;
      const groups: { label: string; commands: string[] }[] = [
        {
          label: "Gateway + pool + DHCP",
          commands: [
            new Cmd("/ip address add")
              .set("address", `${a.gateway}/${prefix}`)
              .set("interface", a.interface)
              .build(),
            new Cmd("/ip pool add").set("name", pool).set("ranges", range).build(),
            new Cmd("/ip dhcp-server add")
              .set("name", profile)
              .set("interface", a.interface)
              .set("address-pool", pool)
              .set("disabled", "no")
              .build(),
            new Cmd("/ip dhcp-server network add")
              .set("address", a.subnet)
              .set("gateway", a.gateway)
              .set("dns-server", a.gateway)
              .build(),
          ],
        },
        {
          label: "Hotspot server + profile (per-guest cap)",
          commands: [
            new Cmd("/ip hotspot profile add")
              .set("name", profile)
              .set("hotspot-address", a.gateway)
              .opt("dns-name", a.dns_name)
              .set("rate-limit", a.rate_limit)
              .build(),
            new Cmd("/ip hotspot add")
              .set("name", profile)
              .set("interface", a.interface)
              .set("address-pool", pool)
              .set("profile", profile)
              .set("addresses-per-mac", 2)
              .build(),
          ],
        },
      ];
      const garden = (a.walled_garden ?? []) as string[];
      if (garden.length) {
        groups.push({
          label: "Walled garden (pre-auth access)",
          commands: garden.map((host) =>
            new Cmd("/ip hotspot walled-garden add")
              .set("dst-host", host)
              .set("comment", `hotspot ${profile}`)
              .build(),
          ),
        });
      }

      const all = groups.flatMap((g) => g.commands);
      if (!a.apply) {
        const preview = groups
          .map((g) => `# ${g.label}\n${g.commands.map((c) => `  ${c}`).join("\n")}`)
          .join("\n\n");
        return `DRY RUN — guest hotspot on '${a.interface}' (${a.subnet}, cap ${a.rate_limit}); ${all.length} command(s) (set apply=true to build):\n\n${preview}`;
      }
      const done: string[] = [];
      for (const cmd of all) {
        const result = await executeMikrotikCommand(cmd, ctx);
        if (looksLikeError(result)) {
          return `Built ${done.length}/${all.length} commands, then FAILED: ${result}\nReview the partial hotspot.`;
        }
        done.push(cmd);
      }
      return `Guest hotspot built on '${a.interface}' (${a.subnet}, ${a.rate_limit} per guest)${garden.length ? `, walled garden: ${garden.join(", ")}` : ""}. Add guest codes with generate_hotspot_vouchers.`;
    },
  }),

  defineTool({
    name: "generate_hotspot_vouchers",
    title: "Generate Hotspot Vouchers",
    annotations: WRITE,
    description:
      "Creates `count` random guest login codes as `/ip hotspot user` entries (username = password = " +
      "code), each with an optional uptime limit and hotspot user profile — the printable vouchers you " +
      "hand to guests. DEFAULTS TO A DRY RUN (`apply=false`) that just shows the codes it would create; " +
      "set `apply=true` to add them. Returns the generated codes.",
    inputSchema: {
      count: z.number().int().min(1).max(200).default(10),
      uptime_limit: z.string().optional().describe("Per-voucher uptime, e.g. '1h', '1d'"),
      profile: z.string().optional().describe("Hotspot user profile to assign"),
      code_prefix: z.string().default("g").describe("Prefix for the generated codes"),
      apply: z.boolean().default(false).describe("false = preview codes (default); true = create"),
    },
    async handler(a, ctx) {
      const codes = Array.from(
        { length: a.count },
        () => `${a.code_prefix}${randomBytes(3).toString("hex")}`,
      );
      if (!a.apply) {
        return `DRY RUN — ${codes.length} voucher(s) would be created (set apply=true):\n\n${codes.join("\n")}`;
      }
      const created: string[] = [];
      for (const code of codes) {
        const cmd = new Cmd("/ip hotspot user add")
          .set("name", code)
          .set("password", code)
          .opt("limit-uptime", a.uptime_limit)
          .opt("profile", a.profile)
          .build();
        const result = await executeMikrotikCommand(cmd, ctx);
        if (looksLikeError(result)) {
          return `Created ${created.length}/${codes.length} vouchers, then FAILED: ${result}\nCodes so far: ${created.join(", ")}`;
        }
        created.push(code);
      }
      return `Created ${created.length} hotspot voucher(s)${a.uptime_limit ? ` (${a.uptime_limit} each)` : ""}:\n\n${created.join("\n")}`;
    },
  }),
];
