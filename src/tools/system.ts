/**
 * System management — `/system`.
 *
 * Identity, resources, health, clock, NTP, packages, history, and the two
 * high-blast-radius lifecycle tools (reboot / shutdown), which require an
 * explicit `confirm=true` guard before they touch the device.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, defineTool, DANGEROUS } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const systemTools: ToolModule = [
  defineTool({
    name: "get_system_identity",
    title: "Get Identity",
    annotations: READ,
    description: "Gets the system identity (hostname) of the MikroTik device.",
    async handler(_a, ctx) {
      ctx.info("Getting system identity");
      const result = await executeMikrotikCommand("/system identity print", ctx);
      return isEmpty(result) ? "No system identity found." : `SYSTEM IDENTITY:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_system_identity",
    title: "Set Identity",
    annotations: WRITE,
    description: "Sets the system identity (hostname) of the MikroTik device.",
    inputSchema: {
      name: z.string().describe("New system identity / hostname"),
    },
    async handler(a, ctx) {
      ctx.info(`Setting system identity: name=${a.name}`);
      const cmd = new Cmd("/system identity set").set("name", a.name).build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to set system identity: ${result}`;

      const details = await executeMikrotikCommand("/system identity print", ctx);
      return `System identity updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "get_system_resources",
    title: "Get Resources",
    annotations: READ,
    description: "Gets system resource information (CPU, memory, uptime, board name, version).",
    async handler(_a, ctx) {
      ctx.info("Getting system resources");
      const result = await executeMikrotikCommand("/system resource print", ctx);
      return isEmpty(result) ? "No system resources found." : `SYSTEM RESOURCES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_system_health",
    title: "Get Health",
    annotations: READ,
    description:
      "Gets system health sensor readings (voltage, temperature, fans). Some devices have no sensors.",
    async handler(_a, ctx) {
      ctx.info("Getting system health");
      const result = await executeMikrotikCommand("/system health print", ctx);
      return isEmpty(result)
        ? "No system health sensors available on this device."
        : `SYSTEM HEALTH:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_routerboard",
    title: "Get RouterBOARD",
    annotations: READ,
    description: "Gets RouterBOARD hardware information (model, serial, firmware).",
    async handler(_a, ctx) {
      ctx.info("Getting RouterBOARD information");
      const result = await executeMikrotikCommand("/system routerboard print", ctx);
      return isEmpty(result) ? "No RouterBOARD information found." : `ROUTERBOARD:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_system_clock",
    title: "Get Clock",
    annotations: READ,
    description: "Gets the current system clock, date, and time-zone settings.",
    async handler(_a, ctx) {
      ctx.info("Getting system clock");
      const result = await executeMikrotikCommand("/system clock print", ctx);
      return isEmpty(result) ? "No system clock information found." : `SYSTEM CLOCK:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_system_clock",
    title: "Set Clock",
    annotations: WRITE,
    description: "Sets system clock settings. Provide at least one of time-zone, date, or time.",
    inputSchema: {
      time_zone_name: z.string().optional().describe("e.g. 'Europe/Amsterdam' or 'manual'"),
      date: z.string().optional().describe("e.g. 'jun/19/2026'"),
      time: z.string().optional().describe("e.g. '13:45:00'"),
    },
    async handler(a, ctx) {
      ctx.info("Setting system clock");
      if (!a.time_zone_name && !a.date && !a.time) return "No clock settings specified.";

      const cmd = new Cmd("/system clock set")
        .opt("time-zone-name", a.time_zone_name)
        .opt("date", a.date)
        .opt("time", a.time)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to set system clock: ${result}`;

      const details = await executeMikrotikCommand("/system clock print", ctx);
      return `System clock updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "get_ntp_client",
    title: "Get NTP Client",
    annotations: READ,
    description: "Gets the NTP client configuration and synchronization status.",
    async handler(_a, ctx) {
      ctx.info("Getting NTP client configuration");
      const result = await executeMikrotikCommand("/system ntp client print", ctx);
      return isEmpty(result) ? "No NTP client information found." : `NTP CLIENT:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_ntp_client",
    title: "Set NTP Client",
    annotations: WRITE,
    description: "Configures the NTP client (enable/disable and server list).",
    inputSchema: {
      enabled: z.boolean().optional().describe("Enable or disable the NTP client"),
      servers: z.string().optional().describe("Comma-separated NTP server list"),
    },
    async handler(a, ctx) {
      ctx.info("Setting NTP client configuration");
      const cmd = new Cmd("/system ntp client set")
        .bool("enabled", a.enabled)
        .opt("servers", a.servers)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to set NTP client: ${result}`;

      const details = await executeMikrotikCommand("/system ntp client print", ctx);
      return `NTP client updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "get_installed_packages",
    title: "List Packages",
    annotations: READ,
    description: "Lists installed software packages and their versions.",
    async handler(_a, ctx) {
      ctx.info("Getting installed packages");
      const result = await executeMikrotikCommand("/system package print", ctx);
      return isEmpty(result) ? "No installed packages found." : `INSTALLED PACKAGES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "check_for_updates",
    title: "Check Updates",
    annotations: READ,
    description: "Checks for available RouterOS updates on the configured update channel.",
    async handler(_a, ctx) {
      ctx.info("Checking for updates");
      const result = await executeMikrotikCommand(
        "/system package update check-for-updates once",
        ctx,
      );
      return isEmpty(result) ? "No update information returned." : `UPDATE CHECK:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_system_history",
    title: "Get History",
    annotations: READ,
    description: "Gets the system change history (recent configuration actions).",
    async handler(_a, ctx) {
      ctx.info("Getting system history");
      const result = await executeMikrotikCommand("/system history print", ctx);
      return isEmpty(result) ? "No system history found." : `SYSTEM HISTORY:\n\n${result}`;
    },
  }),

  defineTool({
    name: "reboot_system",
    title: "Reboot System",
    annotations: DANGEROUS,
    description: "Reboots the MikroTik device. Requires confirm=true; the connection will drop.",
    inputSchema: {
      confirm: z.boolean().describe("Must be true to actually reboot the device"),
    },
    async handler(a, ctx) {
      if (!a.confirm) return "Reboot not confirmed. Pass confirm=true to reboot.";
      ctx.info("Rebooting system");
      await executeMikrotikCommand("/system reboot", ctx);
      return "Reboot command sent. The device is rebooting and the connection will drop.";
    },
  }),

  defineTool({
    name: "shutdown_system",
    title: "Shutdown System",
    annotations: DANGEROUS,
    description: "Shuts down the MikroTik device. Requires confirm=true; the connection will drop.",
    inputSchema: {
      confirm: z.boolean().describe("Must be true to actually shut down the device"),
    },
    async handler(a, ctx) {
      if (!a.confirm) return "Shutdown not confirmed. Pass confirm=true to shutdown.";
      ctx.info("Shutting down system");
      await executeMikrotikCommand("/system shutdown", ctx);
      return "Shutdown command sent.";
    },
  }),
];
