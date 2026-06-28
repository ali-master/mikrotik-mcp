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
    title: "Get System Identity",
    annotations: READ,
    description:
      "Read the system identity (hostname) (`/system identity print`). " +
      "Use to confirm the name the router announces to neighbors, Winbox, and SSH prompts. " +
      "Returns the current `name` field. To change it use `set_system_identity`.",
    async handler(_a, ctx) {
      ctx.info("Getting system identity");
      const result = await executeMikrotikCommand("/system identity print", ctx);
      return isEmpty(result) ? "No system identity found." : `SYSTEM IDENTITY:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_system_identity",
    title: "Set System Identity",
    annotations: WRITE,
    description:
      "Set the system hostname (`/system identity set`) — the name shown in neighbor discovery, " +
      "Winbox title bar, and SSH prompts. " +
      "To read the current value use `get_system_identity`. " +
      "Returns the updated identity after the change.",
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
    title: "Get System Resources",
    annotations: READ,
    description:
      "Return system resource counters (`/system resource print`) — CPU load and count, " +
      "free/total memory, uptime, board name, RouterOS version, and architecture. " +
      "Use to assess load or confirm firmware version. " +
      "For hardware sensor readings (voltage, temperature) use `get_system_health`; " +
      "for hardware model and serial number use `get_routerboard`.",
    async handler(_a, ctx) {
      ctx.info("Getting system resources");
      const result = await executeMikrotikCommand("/system resource print", ctx);
      return isEmpty(result) ? "No system resources found." : `SYSTEM RESOURCES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_system_health",
    title: "Get System Health Sensors",
    annotations: READ,
    description:
      "Read hardware health sensor values (`/system health print`) — PSU voltage, " +
      "CPU/board temperature, and fan speed. " +
      "Not all models expose sensors; returns a 'no sensors available' message for those. " +
      "For CPU load and memory usage use `get_system_resources`; " +
      "for board model and serial number use `get_routerboard`.",
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
    title: "Get RouterBOARD Hardware Info",
    annotations: READ,
    description:
      "Return RouterBOARD hardware details (`/system routerboard print`) — model name, " +
      "serial number, current firmware version, and available upgrade firmware. " +
      "Use to identify physical hardware or confirm firmware state. " +
      "For RouterOS version and resource usage use `get_system_resources`; " +
      "for sensor readings use `get_system_health`.",
    async handler(_a, ctx) {
      ctx.info("Getting RouterBOARD information");
      const result = await executeMikrotikCommand("/system routerboard print", ctx);
      return isEmpty(result) ? "No RouterBOARD information found." : `ROUTERBOARD:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_system_clock",
    title: "Get System Clock",
    annotations: READ,
    description:
      "Read the current system date, time, and time-zone (`/system clock print`). " +
      "Use to verify clock accuracy before troubleshooting logs or certificate validity. " +
      "To adjust the clock use `set_system_clock`; " +
      "for NTP synchronization status use `get_ntp_client`.",
    async handler(_a, ctx) {
      ctx.info("Getting system clock");
      const result = await executeMikrotikCommand("/system clock print", ctx);
      return isEmpty(result) ? "No system clock information found." : `SYSTEM CLOCK:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_system_clock",
    title: "Set System Clock",
    annotations: WRITE,
    description:
      "Set the system date, time, and/or time-zone (`/system clock set`). " +
      "Provide at least one of `time_zone_name` (e.g. `'Europe/Amsterdam'` or `'manual'`), " +
      "`date` (e.g. `'jun/19/2026'`), or `time` (e.g. `'13:45:00'`). " +
      "For automatic time synchronization configure NTP with `set_ntp_client`. " +
      "Returns the updated clock after the change.",
    inputSchema: {
      time_zone_name: z.string().optional().describe("e.g. 'Europe/Amsterdam' or 'manual'"),
      date: z.string().optional().describe("e.g. 'jun/19/2026'"),
      time: z.string().optional().describe("e.g. '13:45:00'"),
      time_zone_autodetect: z
        .boolean()
        .optional()
        .describe("Auto-detect the time zone from the public IP"),
    },
    async handler(a, ctx) {
      ctx.info("Setting system clock");
      if (!a.time_zone_name && !a.date && !a.time && a.time_zone_autodetect === undefined)
        return "No clock settings specified.";

      const cmd = new Cmd("/system clock set")
        .opt("time-zone-name", a.time_zone_name)
        .opt("date", a.date)
        .opt("time", a.time)
        .bool("time-zone-autodetect", a.time_zone_autodetect)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to set system clock: ${result}`;

      const details = await executeMikrotikCommand("/system clock print", ctx);
      return `System clock updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "get_ntp_client",
    title: "Get NTP Client Configuration",
    annotations: READ,
    description:
      "Read NTP client settings and synchronization status (`/system ntp client print`) — " +
      "enabled state, server list, and last sync result. " +
      "Use to verify whether the router clock is synchronizing automatically. " +
      "To enable NTP or change servers use `set_ntp_client`; " +
      "to read the resulting system time use `get_system_clock`.",
    async handler(_a, ctx) {
      ctx.info("Getting NTP client configuration");
      const result = await executeMikrotikCommand("/system ntp client print", ctx);
      return isEmpty(result) ? "No NTP client information found." : `NTP CLIENT:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_ntp_client",
    title: "Set NTP Client Configuration",
    annotations: WRITE,
    description:
      "Configure the NTP client (`/system ntp client set`) — enable or disable it " +
      "and set the server list as a comma-separated string (e.g. `'0.pool.ntp.org,1.pool.ntp.org'`). " +
      "To read current NTP status use `get_ntp_client`; " +
      "to set the clock manually instead use `set_system_clock`. " +
      "Returns the updated NTP client configuration after the change.",
    inputSchema: {
      enabled: z.boolean().optional().describe("Enable or disable the NTP client"),
      servers: z.string().optional().describe("Comma-separated NTP server list"),
      mode: z
        .enum(["unicast", "broadcast", "multicast", "manycast"])
        .optional()
        .describe("NTP client operating mode"),
      vrf: z.string().optional().describe("VRF the NTP client operates in (e.g. 'main')"),
    },
    async handler(a, ctx) {
      ctx.info("Setting NTP client configuration");
      const cmd = new Cmd("/system ntp client set")
        .bool("enabled", a.enabled)
        .opt("servers", a.servers)
        .opt("mode", a.mode)
        .opt("vrf", a.vrf)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to set NTP client: ${result}`;

      const details = await executeMikrotikCommand("/system ntp client print", ctx);
      return `NTP client updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "get_installed_packages",
    title: "List Installed Packages",
    annotations: READ,
    description:
      "List all RouterOS software packages installed on the device (`/system package print`) " +
      "including name, version, and enabled state. " +
      "Use to confirm which feature packages (e.g. `routing`, `security`, `wireless`) are present. " +
      "To check for newer versions available on the update channel use `check_for_updates`.",
    async handler(_a, ctx) {
      ctx.info("Getting installed packages");
      const result = await executeMikrotikCommand("/system package print", ctx);
      return isEmpty(result) ? "No installed packages found." : `INSTALLED PACKAGES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "check_for_updates",
    title: "Check for RouterOS Updates",
    annotations: READ,
    description:
      "Query the configured update channel for available RouterOS updates " +
      "(`/system package update check-for-updates once`). " +
      "Returns the latest version available on the channel and whether the device is up to date. " +
      "To see what is currently installed use `get_installed_packages`.",
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
    title: "Get System Change History",
    annotations: READ,
    description:
      "Read the system change history log (`/system history print`) — a record of recent " +
      "configuration actions applied to the device, including undo/redo entries. " +
      "Use to audit recent changes or identify what was modified before a problem appeared.",
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
    description:
      "Send a reboot command to the device (`/system reboot`). " +
      "This is a high-blast-radius action: all connections drop and the device is offline for " +
      "1-2 minutes while it restarts. " +
      "Must pass `confirm=true` or the command is rejected without touching the device. " +
      "For a permanent power-off use `shutdown_system`.",
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
    description:
      "Power off the device (`/system shutdown`). " +
      "This is a high-blast-radius action: all connections drop and the device remains offline " +
      "until physically powered on again. " +
      "Must pass `confirm=true` or the command is rejected without touching the device. " +
      "For a temporary restart use `reboot_system`.",
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
