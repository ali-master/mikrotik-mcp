/**
 * System configuration menus — `/system` (console, leds, license, note,
 * ntp server, special-login, watchdog), `/port`, `/password`, the wireless
 * regulatory/country domain, and the factory `reset-configuration` guard.
 *
 * Companion to system.ts: this module covers the lower-traffic `/system`
 * sub-menus plus serial ports and password/reset lifecycle tools. Several
 * menus are hardware/version dependent, so reads fall back to a friendly
 * message when `commandUnsupported(result)`.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import {
  WRITE_IDEMPOTENT,
  WRITE,
  READ,
  defineTool,
  DANGEROUS,
} from "../core/registry";
import type { ToolModule } from "../core/registry";
import {
  whereClause,
  looksLikeError,
  isEmpty,
  commandUnsupported,
  Cmd,
} from "../core/routeros";

export const systemConfigTools: ToolModule = [
  // ── Console `/system console` ───────────────────────────────────────────
  defineTool({
    name: "list_system_console",
    title: "List Console",
    annotations: READ,
    description: "Lists the system console sessions/ports (`/system console`).",
    async handler(_a, ctx) {
      ctx.info("Listing system console");
      const result = await executeMikrotikCommand("/system console print", ctx);
      return isEmpty(result)
        ? "No system console entries found."
        : `SYSTEM CONSOLE:\n\n${result}`;
    },
  }),

  // ── LEDs `/system leds` ─────────────────────────────────────────────────
  defineTool({
    name: "list_leds",
    title: "List LEDs",
    annotations: READ,
    description:
      "Lists the configured LEDs and their triggers (`/system leds`).",
    async handler(_a, ctx) {
      ctx.info("Listing LEDs");
      const result = await executeMikrotikCommand("/system leds print", ctx);
      return isEmpty(result)
        ? "No LEDs found on this device."
        : `LEDS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_leds_settings",
    title: "Get LED Settings",
    annotations: READ,
    description: "Gets the global LED settings (`/system leds settings`).",
    async handler(_a, ctx) {
      ctx.info("Getting LED settings");
      const result = await executeMikrotikCommand(
        "/system leds settings print",
        ctx,
      );
      return isEmpty(result)
        ? "No LED settings found."
        : `LED SETTINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_leds_settings",
    title: "Set LED Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates the global LED settings, e.g. dark-mode scheduling via all-leds-off.",
    inputSchema: {
      all_leds_off: z
        .enum(["never", "immediate", "after-1h", "after-1min"])
        .optional()
        .describe("When to turn all LEDs off (dark mode)"),
    },
    async handler(a, ctx) {
      ctx.info("Setting LED settings");
      if (a.all_leds_off === undefined) return "No updates specified.";

      const cmd = new Cmd("/system leds settings set")
        .opt("all-leds-off", a.all_leds_off)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to set LED settings: ${result}`;

      const details = await executeMikrotikCommand(
        "/system leds settings print",
        ctx,
      );
      return `LED settings updated successfully:\n\n${details}`;
    },
  }),

  // ── License `/system license` ───────────────────────────────────────────
  defineTool({
    name: "get_license",
    title: "Get License",
    annotations: READ,
    description:
      "Gets the RouterOS license (`/system license`). On CHR shows the license level and deadline; on RouterBOARD the menu may differ or be absent.",
    async handler(_a, ctx) {
      ctx.info("Getting system license");
      const result = await executeMikrotikCommand("/system license print", ctx);
      if (commandUnsupported(result))
        return "License info not available on this device.";
      return isEmpty(result)
        ? "No license information found."
        : `LICENSE:\n\n${result}`;
    },
  }),

  // ── Note `/system note` ─────────────────────────────────────────────────
  defineTool({
    name: "get_note",
    title: "Get Note",
    annotations: READ,
    description: "Gets the system note shown at login (`/system note`).",
    async handler(_a, ctx) {
      ctx.info("Getting system note");
      const result = await executeMikrotikCommand("/system note print", ctx);
      return isEmpty(result)
        ? "No system note found."
        : `SYSTEM NOTE:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_note",
    title: "Set Note",
    annotations: WRITE_IDEMPOTENT,
    description: "Sets the system note and whether it is displayed at login.",
    inputSchema: {
      note: z.string().optional().describe("The note text to display"),
      show_at_login: z.boolean().optional().describe("Show the note on login"),
    },
    async handler(a, ctx) {
      ctx.info("Setting system note");
      if (a.note === undefined && a.show_at_login === undefined)
        return "No updates specified.";

      const cmd = new Cmd("/system note set")
        .opt("note", a.note)
        .bool("show-at-login", a.show_at_login)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to set system note: ${result}`;

      const details = await executeMikrotikCommand("/system note print", ctx);
      return `System note updated successfully:\n\n${details}`;
    },
  }),

  // ── NTP server `/system ntp server` (RouterOS 7) ────────────────────────
  defineTool({
    name: "get_ntp_server",
    title: "Get NTP Server",
    annotations: READ,
    description:
      "Gets the NTP server configuration (`/system ntp server`, RouterOS 7).",
    async handler(_a, ctx) {
      ctx.info("Getting NTP server configuration");
      const result = await executeMikrotikCommand(
        "/system ntp server print",
        ctx,
      );
      if (commandUnsupported(result))
        return "NTP server is not available on this RouterOS version.";
      return isEmpty(result)
        ? "No NTP server information found."
        : `NTP SERVER:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_ntp_server",
    title: "Set NTP Server",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Configures the built-in NTP server (enable, broadcast/multicast/manycast modes).",
    inputSchema: {
      enabled: z
        .boolean()
        .optional()
        .describe("Enable or disable the NTP server"),
      broadcast: z.boolean().optional(),
      multicast: z.boolean().optional(),
      manycast: z.boolean().optional(),
      broadcast_address: z
        .string()
        .optional()
        .describe("Broadcast address for NTP broadcasts"),
    },
    async handler(a, ctx) {
      ctx.info("Setting NTP server configuration");
      if (
        a.enabled === undefined &&
        a.broadcast === undefined &&
        a.multicast === undefined &&
        a.manycast === undefined &&
        a.broadcast_address === undefined
      ) {
        return "No updates specified.";
      }

      const cmd = new Cmd("/system ntp server set")
        .bool("enabled", a.enabled)
        .bool("broadcast", a.broadcast)
        .bool("multicast", a.multicast)
        .bool("manycast", a.manycast)
        .opt("broadcast-address", a.broadcast_address)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to set NTP server: ${result}`;

      const details = await executeMikrotikCommand(
        "/system ntp server print",
        ctx,
      );
      return `NTP server updated successfully:\n\n${details}`;
    },
  }),

  // ── Passwords `/password` ───────────────────────────────────────────────
  defineTool({
    name: "change_password",
    title: "Change Password",
    annotations: WRITE,
    description:
      "Changes the current user's login password (`/password`). The old and new passwords are never echoed back in the result.",
    inputSchema: {
      old_password: z.string().describe("The current password"),
      new_password: z.string().describe("The new password to set"),
    },
    async handler(a, ctx) {
      ctx.info("Changing device password"); // never log the secrets
      const cmd = new Cmd("/password")
        .set("old-password", a.old_password)
        .set("new-password", a.new_password)
        .set("confirm-new-password", a.new_password)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      // Never echo the passwords back, even in the error path.
      if (looksLikeError(result))
        return "Failed to change password: the device rejected the request (check the old password and password policy).";
      return "Password changed successfully.";
    },
  }),

  // ── Serial ports `/port` ────────────────────────────────────────────────
  defineTool({
    name: "list_ports",
    title: "List Serial Ports",
    annotations: READ,
    description: "Lists the device's serial ports (`/port`).",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial port name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing serial ports");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/port print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No serial ports found matching the criteria."
        : `SERIAL PORTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_port",
    title: "Get Serial Port",
    annotations: READ,
    description: "Gets detailed information about a specific serial port.",
    inputSchema: {
      name: z.string().describe("Serial port name, e.g. 'serial0'"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting serial port details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/port print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `Serial port '${a.name}' not found.`
        : `SERIAL PORT DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_port",
    title: "Set Serial Port",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates a serial port's line settings (baud rate, data/stop bits, parity, flow control).",
    inputSchema: {
      name: z.string().describe("Serial port name to update"),
      baud_rate: z.string().optional().describe("e.g. '115200' or 'auto'"),
      data_bits: z.number().int().optional(),
      parity: z.enum(["none", "odd", "even"]).optional(),
      stop_bits: z.number().int().optional(),
      flow_control: z.enum(["none", "hardware", "xon-xoff"]).optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Setting serial port: name=${a.name}`);
      if (
        a.baud_rate === undefined &&
        a.data_bits === undefined &&
        a.parity === undefined &&
        a.stop_bits === undefined &&
        a.flow_control === undefined
      ) {
        return "No updates specified.";
      }

      const cmd = new Cmd(`/port set [find name="${a.name}"]`)
        .opt("baud-rate", a.baud_rate)
        .opt("data-bits", a.data_bits)
        .opt("parity", a.parity)
        .opt("stop-bits", a.stop_bits)
        .opt("flow-control", a.flow_control)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to set serial port: ${result}`;

      const details = await executeMikrotikCommand(
        `/port print detail where name="${a.name}"`,
        ctx,
      );
      return `Serial port updated successfully:\n\n${details}`;
    },
  }),

  // ── Regulatory / country (wireless) ─────────────────────────────────────
  defineTool({
    name: "get_regulatory",
    title: "Get Regulatory",
    annotations: READ,
    description:
      "Surfaces the wireless regulatory/country domain. RouterOS has no `/system regulatory` menu; this reads `/interface wifi radio` (wifiwave2), which exposes the country and regulatory settings of the radios.",
    async handler(_a, ctx) {
      ctx.info("Getting wireless regulatory / country information");
      const result = await executeMikrotikCommand(
        "/interface wifi radio print",
        ctx,
      );
      if (commandUnsupported(result)) {
        return "No wireless regulatory/country information is available on this device (no Wi-Fi interface, or a different wireless package).";
      }
      return isEmpty(result)
        ? "No wireless regulatory/country information is available on this device (no Wi-Fi interface, or a different wireless package)."
        : `WIRELESS REGULATORY / COUNTRY:\n\n${result}`;
    },
  }),

  // ── Reset configuration `/system reset-configuration` ───────────────────
  defineTool({
    name: "reset_configuration",
    title: "Reset Configuration",
    annotations: DANGEROUS,
    description:
      "Factory-resets the device configuration (`/system reset-configuration`). Requires confirm=true; the device reboots into a default configuration and the connection will drop.",
    inputSchema: {
      confirm: z
        .boolean()
        .describe("Must be true to actually ERASE the configuration"),
      keep_users: z
        .boolean()
        .optional()
        .describe("Keep existing user accounts after reset"),
      no_defaults: z
        .boolean()
        .optional()
        .describe("Do not load the default configuration"),
      skip_backup: z
        .boolean()
        .optional()
        .describe("Skip the automatic backup before reset"),
      run_after_reset: z
        .string()
        .optional()
        .describe("Script file to run after reset"),
    },
    async handler(a, ctx) {
      if (!a.confirm)
        return "Reset not confirmed. Pass confirm=true to ERASE the configuration.";
      ctx.info("Resetting device configuration");
      const cmd = new Cmd("/system reset-configuration")
        .flag("keep-users", a.keep_users)
        .flag("no-defaults", a.no_defaults)
        .flag("skip-backup", a.skip_backup)
        .opt("run-after-reset", a.run_after_reset)
        .build();
      await executeMikrotikCommand(cmd, ctx);
      return "Reset command sent — the device will reboot to a default configuration and the connection will drop.";
    },
  }),

  // ── Special login `/system special-login` ───────────────────────────────
  defineTool({
    name: "list_special_login",
    title: "List Special Login",
    annotations: READ,
    description:
      "Lists special-login entries, e.g. serial-console auto-login (`/system special-login`).",
    async handler(_a, ctx) {
      ctx.info("Listing special login");
      const result = await executeMikrotikCommand(
        "/system special-login print",
        ctx,
      );
      if (commandUnsupported(result))
        return "Special login is not available on this device.";
      return isEmpty(result)
        ? "No special-login entries found."
        : `SPECIAL LOGIN:\n\n${result}`;
    },
  }),

  // ── Watchdog `/system watchdog` ─────────────────────────────────────────
  defineTool({
    name: "get_watchdog",
    title: "Get Watchdog",
    annotations: READ,
    description:
      "Gets the hardware/software watchdog configuration (`/system watchdog`).",
    async handler(_a, ctx) {
      ctx.info("Getting watchdog configuration");
      const result = await executeMikrotikCommand(
        "/system watchdog print",
        ctx,
      );
      return isEmpty(result)
        ? "No watchdog information found."
        : `WATCHDOG:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_watchdog",
    title: "Set Watchdog",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Configures the watchdog timer and the host it pings to detect a hung device.",
    inputSchema: {
      watchdog_timer: z
        .boolean()
        .optional()
        .describe("Enable the hardware watchdog timer"),
      watch_address: z
        .string()
        .optional()
        .describe("Address to ping; reboot if unreachable"),
      ping_timeout: z.string().optional().describe("e.g. '1m'"),
      no_ping_delay: z.string().optional().describe("e.g. '5m'"),
      automatic_supout: z
        .boolean()
        .optional()
        .describe("Generate a supout.rif on software failure"),
      auto_send_supout: z
        .boolean()
        .optional()
        .describe("Email the generated supout.rif"),
    },
    async handler(a, ctx) {
      ctx.info("Setting watchdog configuration");
      if (
        a.watchdog_timer === undefined &&
        a.watch_address === undefined &&
        a.ping_timeout === undefined &&
        a.no_ping_delay === undefined &&
        a.automatic_supout === undefined &&
        a.auto_send_supout === undefined
      ) {
        return "No updates specified.";
      }

      const cmd = new Cmd("/system watchdog set")
        .bool("watchdog-timer", a.watchdog_timer)
        .opt("watch-address", a.watch_address)
        .opt("ping-timeout", a.ping_timeout)
        .opt("no-ping-delay", a.no_ping_delay)
        .bool("automatic-supout", a.automatic_supout)
        .bool("auto-send-supout", a.auto_send_supout)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to set watchdog: ${result}`;

      const details = await executeMikrotikCommand(
        "/system watchdog print",
        ctx,
      );
      return `Watchdog updated successfully:\n\n${details}`;
    },
  }),
];
