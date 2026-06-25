/**
 * IP Cloud — `/ip cloud`. RouterOS's built-in cloud DDNS: it gives the router a
 * stable `<serial>.sn.mynetname.net` DNS name that tracks its public IP, so you
 * can reach a router on a dynamic WAN address. Includes the advanced `use-local-
 * address` toggle and a force-update action.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, WRITE_IDEMPOTENT, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const ipCloudTools: ToolModule = [
  defineTool({
    name: "get_ip_cloud",
    title: "Get IP Cloud (DDNS) Status",
    annotations: READ,
    description:
      "Reads the RouterOS cloud DDNS status (`/ip cloud print`) — whether `ddns-enabled` is on, the " +
      "assigned `dns-name` (`<serial>.sn.mynetname.net`), the detected public IPv4/IPv6 address, the " +
      "last `update-time`, and the service `status`/warnings. Use this to find the router's stable cloud " +
      "hostname or check why DDNS isn't updating. To change it use set_ip_cloud; to push an update now " +
      "use force_cloud_update. Returns the full cloud status block.",
    async handler(_a, ctx) {
      ctx.info("Reading IP cloud status");
      const result = await executeMikrotikCommand("/ip cloud print", ctx);
      return isEmpty(result) ? "No IP cloud information returned." : `IP CLOUD:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_ip_cloud",
    title: "Configure IP Cloud (DDNS)",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Configures RouterOS cloud DDNS (`/ip cloud set`). Enable/disable the dynamic DNS name with " +
      "`ddns_enabled`, optionally also sync the router clock from the cloud with `update_time`. When " +
      "enabled the router registers a `<serial>.sn.mynetname.net` name that follows its public IP. To " +
      "read the resulting name/status use get_ip_cloud; to force an immediate refresh use " +
      "force_cloud_update; for the local-vs-public address behaviour use set_ip_cloud_advanced. Returns " +
      "the updated cloud status.",
    inputSchema: {
      ddns_enabled: z
        .boolean()
        .optional()
        .describe("Enable (true) or disable (false) the DDNS name"),
      update_time: z.boolean().optional().describe("Also sync the router clock from the cloud"),
    },
    async handler(a, ctx) {
      ctx.info("Configuring IP cloud");
      const cmd = new Cmd("/ip cloud set")
        .bool("ddns-enabled", a.ddns_enabled)
        .bool("update-time", a.update_time)
        .build();
      if (cmd === "/ip cloud set") return "No updates specified.";
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to configure IP cloud: ${result}`;
      const status = await executeMikrotikCommand("/ip cloud print", ctx);
      return `IP cloud updated:\n\n${status}`;
    },
  }),

  defineTool({
    name: "force_cloud_update",
    title: "Force IP Cloud DDNS Update",
    annotations: WRITE,
    description:
      "Forces an immediate cloud DDNS refresh (`/ip cloud force-update`) — pushes the router's current " +
      "public IP to the cloud now instead of waiting for the next scheduled update. Use after a WAN IP " +
      "change or to test connectivity to the cloud service. Requires DDNS to be enabled (see " +
      "set_ip_cloud). Returns the cloud status after the update.",
    async handler(_a, ctx) {
      ctx.info("Forcing IP cloud update");
      const result = await executeMikrotikCommand("/ip cloud force-update", ctx);
      if (looksLikeError(result)) return `Failed to force cloud update: ${result}`;
      const status = await executeMikrotikCommand("/ip cloud print", ctx);
      return `Cloud update requested:\n\n${status}`;
    },
  }),

  defineTool({
    name: "set_ip_cloud_advanced",
    title: "Set IP Cloud Advanced Options",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Sets advanced cloud options (`/ip cloud advanced set`). `use_local_address=true` makes the cloud " +
      "DDNS publish the router's LOCAL address instead of the detected public one (useful behind a " +
      "private WAN / when you reach the router over a VPN). For the main DDNS toggle use set_ip_cloud. " +
      "Returns the updated cloud status.",
    inputSchema: {
      use_local_address: z
        .boolean()
        .describe("Publish the local address (true) instead of the public address (false)"),
    },
    async handler(a, ctx) {
      ctx.info(`Setting IP cloud advanced: use-local-address=${a.use_local_address}`);
      const cmd = new Cmd("/ip cloud advanced set")
        .bool("use-local-address", a.use_local_address)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to set IP cloud advanced: ${result}`;
      const status = await executeMikrotikCommand("/ip cloud print", ctx);
      return `IP cloud advanced updated:\n\n${status}`;
    },
  }),
];
