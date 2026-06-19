/**
 * Wireless — `/interface wifi` · `/interface wifiwave2` · `/interface wireless` · `/interface wlan`.
 *
 * Covers wireless interfaces, (legacy) security profiles, (legacy) access lists,
 * scanning, the registration table, and a support check. RouterOS moved wireless
 * around a lot between v6 and v7, so every tool first auto-detects which wireless
 * command path the device speaks before issuing its real command.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE,  READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type {ToolModule} from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";
import type { ToolContext } from "../core/context";

/** The v7-era wifi command paths where security profiles / access lists no longer apply. */
const V7_WIFI = ["/interface wifi", "/interface wifiwave2"];

/** True when RouterOS reports that a command path simply doesn't exist on this device. */
function commandUnsupported(result: string): boolean {
  const t = result.toLowerCase();
  return (
    t.includes("bad command name") ||
    t.includes("failure:") ||
    t.includes("no such command prefix") ||
    t.includes("invalid command name")
  );
}

/**
 * Detects the wireless interface command path supported by the device, trying the
 * v7 paths first and falling back to the legacy ones. Returns null if none work.
 */
async function detectWirelessInterfaceType(ctx: ToolContext): Promise<string | null> {
  ctx.info("Detecting wireless interface type");

  const interfaceTypes = [
    "/interface wifi", // RouterOS v7.x (newest)
    "/interface wifiwave2", // RouterOS v7.x (alternative)
    "/interface wireless", // RouterOS v6.x
    "/interface wlan", // Older versions
  ];

  for (const interfaceType of interfaceTypes) {
    const result = await executeMikrotikCommand(`${interfaceType} print count-only`, ctx);
    if (result && !commandUnsupported(result)) {
      ctx.info(`Detected wireless interface type: ${interfaceType}`);
      return interfaceType;
    }
  }

  ctx.info("No wireless interface type detected");
  return null;
}

export const wirelessTools: ToolModule = [
  defineTool({
    name: "create_wireless_interface",
    title: "Create Wireless Interface",
    annotations: WRITE,
    description:
      "Creates a wireless interface on the MikroTik device (auto-detects RouterOS v6/v7 syntax).",
    inputSchema: {
      name: z.string(),
      ssid: z.string().optional(),
      disabled: z.boolean().default(false),
      comment: z.string().optional(),
      radio_name: z.string().optional().describe("Required for legacy wireless systems, e.g. 'wlan1'"),
      mode: z
        .enum([
          "ap-bridge",
          "bridge",
          "station",
          "station-pseudobridge",
          "station-bridge",
          "station-wds",
          "ap-bridge-wds",
          "alignment-only",
        ])
        .optional(),
      frequency: z.string().optional(),
      band: z
        .enum([
          "2ghz-b",
          "2ghz-b/g",
          "2ghz-b/g/n",
          "5ghz-a",
          "5ghz-a/n",
          "5ghz-a/n/ac",
          "2ghz-g",
          "2ghz-n",
          "5ghz-n",
          "5ghz-ac",
        ])
        .optional(),
      channel_width: z
        .enum(["20mhz", "40mhz", "80mhz", "160mhz", "20/40mhz-eC", "20/40mhz-Ce"])
        .optional(),
      security_profile: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Creating wireless interface: name=${a.name}, ssid=${a.ssid}`);

      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (!interfaceType) return "Error: No wireless interface support detected on this device.";

      let cmd: string;
      if (interfaceType === "/interface wifi" || interfaceType === "/interface wifiwave2") {
        // RouterOS v7.x syntax (wifi / wifiwave2) — simplified.
        cmd = new Cmd(`${interfaceType} add`)
          .set("name", a.name)
          .opt("ssid", a.ssid)
          .flag("disabled", a.disabled)
          .opt("comment", a.comment)
          .build();
      } else {
        // Legacy wireless syntax (RouterOS v6.x and older).
        if (!a.radio_name) {
          return "Error: radio_name is required for legacy wireless systems. Please specify the radio interface (e.g., 'wlan1').";
        }
        cmd = new Cmd(`${interfaceType} add`)
          .set("name", a.name)
          .set("radio-name", a.radio_name)
          .set("mode", a.mode ?? "ap-bridge")
          .opt("ssid", a.ssid)
          .flag("disabled", a.disabled)
          .opt("comment", a.comment)
          .opt("frequency", a.frequency)
          .opt("band", a.band)
          .opt("channel-width", a.channel_width)
          .opt("security-profile", a.security_profile)
          .build();
      }

      ctx.info(`Executing command: ${cmd}`);
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create wireless interface: ${result}`;

      const details = await executeMikrotikCommand(
        `${interfaceType} print detail where name="${a.name}"`,
        ctx,
      );
      return `Wireless interface created successfully using ${interfaceType}:\n\n${details}`;
    },
  }),

  defineTool({
    name: "list_wireless_interfaces",
    title: "List Wireless Interfaces",
    annotations: READ,
    description: "Lists wireless interfaces on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      running_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Listing wireless interfaces with filters: name=${a.name_filter}`);

      // Try multiple interface types to ensure we find all wireless interfaces.
      const interfaceTypesToTry = [
        "/interface wifi",
        "/interface wifiwave2",
        "/interface wireless",
        "/interface wlan",
      ];

      const allResults: string[] = [];
      const workingTypes: string[] = [];

      for (const interfaceType of interfaceTypesToTry) {
        const filters: string[] = [];
        if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
        if (a.disabled_only) filters.push("disabled=yes");
        if (a.running_only) filters.push("running=yes");

        let cmd = `${interfaceType} print`;
        if (filters.length) cmd += ` where ${  filters.join(" and ")}`;

        const result = await executeMikrotikCommand(cmd, ctx);

        if (result && result.trim() !== "" && !commandUnsupported(result)) {
          workingTypes.push(interfaceType);
          allResults.push(`=== ${interfaceType.toUpperCase()} ===\n${result}`);
        }
      }

      if (allResults.length) {
        return `WIRELESS INTERFACES:\n\n${  allResults.join("\n\n")}`;
      }

      // If no results found, show all interfaces to help debug.
      const allInterfaces = await executeMikrotikCommand("/interface print", ctx);
      return `No wireless interfaces found matching the criteria.

DEBUGGING INFO:
Working interface types: ${workingTypes.length ? workingTypes.join(", ") : "None detected"}

ALL INTERFACES ON DEVICE:
${allInterfaces}

NOTE: If you see wireless interfaces above, they might be using a different command structure.`;
    },
  }),

  defineTool({
    name: "get_wireless_interface",
    title: "Get Wireless Interface",
    annotations: READ,
    description: "Gets detailed information about a specific wireless interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting wireless interface details: name=${a.name}`);

      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (!interfaceType) return "Error: No wireless interface support detected on this device.";

      const result = await executeMikrotikCommand(
        `${interfaceType} print detail where name="${a.name}"`,
        ctx,
      );
      if (isEmpty(result)) return `Wireless interface '${a.name}' not found.`;

      return `WIRELESS INTERFACE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_wireless_interface",
    title: "Remove Wireless Interface",
    annotations: DESTRUCTIVE,
    description: "Removes a wireless interface from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing wireless interface: name=${a.name}`);

      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (!interfaceType) return "Error: No wireless interface support detected on this device.";

      const count = await executeMikrotikCommand(
        `${interfaceType} print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `Wireless interface '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `${interfaceType} remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove wireless interface: ${result}`;

      return `Wireless interface '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_wireless_interface",
    title: "Enable Wireless Interface",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a wireless interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Enabling wireless interface: ${a.name}`);

      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (!interfaceType) return "Error: No wireless interface support detected on this device.";

      const result = await executeMikrotikCommand(
        `${interfaceType} enable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to enable wireless interface: ${result}`;

      return `Wireless interface '${a.name}' enabled successfully.`;
    },
  }),

  defineTool({
    name: "disable_wireless_interface",
    title: "Disable Wireless Interface",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a wireless interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Disabling wireless interface: ${a.name}`);

      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (!interfaceType) return "Error: No wireless interface support detected on this device.";

      const result = await executeMikrotikCommand(
        `${interfaceType} disable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to disable wireless interface: ${result}`;

      return `Wireless interface '${a.name}' disabled successfully.`;
    },
  }),

  defineTool({
    name: "scan_wireless_networks",
    title: "Scan Wireless Networks",
    annotations: READ,
    description: "Scans for nearby wireless networks using the specified interface.",
    inputSchema: {
      interface: z.string(),
      duration: z.number().int().default(5),
    },
    async handler(a, ctx) {
      ctx.info(`Scanning wireless networks on interface: ${a.interface}`);

      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (!interfaceType) return "Error: No wireless interface support detected on this device.";

      const scanCmd = new Cmd(`${interfaceType} scan`)
        .raw(a.interface)
        .set("duration", a.duration)
        .build();

      const result = await executeMikrotikCommand(scanCmd, ctx);
      if (looksLikeError(result)) return `Failed to scan wireless networks: ${result}`;

      return `WIRELESS NETWORK SCAN RESULTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_wireless_registration_table",
    title: "Wireless Registration Table",
    annotations: READ,
    description:
      "Gets the wireless registration table (connected clients) from the MikroTik device.",
    inputSchema: {
      interface: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Getting wireless registration table for interface: ${a.interface}`);

      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (!interfaceType) return "Error: No wireless interface support detected on this device.";

      let cmd = `${interfaceType} registration-table print`;
      if (a.interface) cmd += ` where interface="${a.interface}"`;

      const result = await executeMikrotikCommand(cmd, ctx);
      if (isEmpty(result)) return "No wireless clients registered.";

      return `WIRELESS REGISTRATION TABLE:\n\n${result}`;
    },
  }),

  defineTool({
    name: "check_wireless_support",
    title: "Check Wireless Support",
    annotations: READ,
    description:
      "Checks if the device supports wireless and reports the RouterOS version and wireless interface type.",
    async handler(_a, ctx) {
      ctx.info("Checking wireless support");

      const versionResult = await executeMikrotikCommand("/system resource print", ctx);
      const packageResult = await executeMikrotikCommand("/system package print", ctx);
      const interfaceResult = await executeMikrotikCommand("/interface print", ctx);
      const wirelessType = await detectWirelessInterfaceType(ctx);

      return `WIRELESS SUPPORT CHECK:

RouterOS Version:
${versionResult}

Installed Packages:
${packageResult}

Available Interfaces:
${interfaceResult}

Detected Wireless Interface Type: ${wirelessType || "None detected"}

Compatibility Notes:
- RouterOS v7.x uses '/interface wifi' (newest system)
- RouterOS v7.x also supports '/interface wifiwave2' (alternative)
- RouterOS v6.x uses '/interface wireless' (legacy system)
- Older versions may use '/interface wlan'

USAGE EXAMPLES:
For RouterOS v7.x:
  mikrotik_create_wireless_interface(name="wlan1", ssid="MyNetwork")

For legacy systems:
  mikrotik_create_wireless_interface(name="wlan1", radio_name="wlan1", ssid="MyNetwork")
`;
    },
  }),

  defineTool({
    name: "create_wireless_security_profile",
    title: "Create Wireless Security Profile",
    annotations: WRITE,
    description: "Legacy function - not supported in RouterOS v7.x",
    inputSchema: { name: z.string() },
    async handler(_a, ctx) {
      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (interfaceType && V7_WIFI.includes(interfaceType)) {
        return "Security profiles are not used in RouterOS v7.x. Configure security directly on the wireless interface.";
      }
      return "Legacy security profile creation not implemented in this version.";
    },
  }),

  defineTool({
    name: "list_wireless_security_profiles",
    title: "List Wireless Security Profiles",
    annotations: READ,
    description: "Legacy function - not supported in RouterOS v7.x",
    async handler(_a, ctx) {
      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (interfaceType && V7_WIFI.includes(interfaceType)) {
        return "Security profiles are not used in RouterOS v7.x. Security is configured directly on wireless interfaces.";
      }
      return "Legacy security profile listing not implemented in this version.";
    },
  }),

  defineTool({
    name: "get_wireless_security_profile",
    title: "Get Wireless Security Profile",
    annotations: READ,
    description: "Legacy function - not supported in RouterOS v7.x",
    inputSchema: { name: z.string() },
    async handler(_a, ctx) {
      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (interfaceType && V7_WIFI.includes(interfaceType)) {
        return "Security profiles are not used in RouterOS v7.x. Check security configuration on wireless interfaces directly.";
      }
      return "Legacy security profile details not implemented in this version.";
    },
  }),

  defineTool({
    name: "remove_wireless_security_profile",
    title: "Remove Wireless Security Profile",
    annotations: DESTRUCTIVE,
    description: "Legacy function - not supported in RouterOS v7.x",
    inputSchema: { name: z.string() },
    async handler(_a, ctx) {
      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (interfaceType && V7_WIFI.includes(interfaceType)) {
        return "Security profiles are not used in RouterOS v7.x. Security is configured directly on wireless interfaces.";
      }
      return "Legacy security profile removal not implemented in this version.";
    },
  }),

  defineTool({
    name: "set_wireless_security_profile",
    title: "Set Wireless Security Profile",
    annotations: WRITE,
    description: "Legacy function - not supported in RouterOS v7.x",
    inputSchema: {
      interface_name: z.string(),
      security_profile: z.string(),
    },
    async handler(_a, ctx) {
      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (interfaceType && V7_WIFI.includes(interfaceType)) {
        return "Security profiles are not used in RouterOS v7.x. Configure security directly on the wireless interface.";
      }
      return "Legacy security profile setting not implemented in this version.";
    },
  }),

  defineTool({
    name: "create_wireless_access_list",
    title: "Create Wireless Access List",
    annotations: WRITE,
    description: "Legacy function - different in RouterOS v7.x",
    async handler(_a, ctx) {
      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (interfaceType && V7_WIFI.includes(interfaceType)) {
        return "Access lists are configured differently in RouterOS v7.x. Use firewall rules or other access control methods.";
      }
      return "Legacy access list creation not implemented in this version.";
    },
  }),

  defineTool({
    name: "list_wireless_access_list",
    title: "List Wireless Access List",
    annotations: READ,
    description: "Legacy function - different in RouterOS v7.x",
    async handler(_a, ctx) {
      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (interfaceType && V7_WIFI.includes(interfaceType)) {
        return "Access lists are configured differently in RouterOS v7.x. Check firewall rules or other access control configurations.";
      }
      return "Legacy access list listing not implemented in this version.";
    },
  }),

  defineTool({
    name: "remove_wireless_access_list_entry",
    title: "Remove Wireless Access List Entry",
    annotations: DESTRUCTIVE,
    description: "Legacy function - different in RouterOS v7.x",
    inputSchema: { entry_id: z.string() },
    async handler(_a, ctx) {
      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (interfaceType && V7_WIFI.includes(interfaceType)) {
        return "Access lists are configured differently in RouterOS v7.x.";
      }
      return "Legacy access list removal not implemented in this version.";
    },
  }),

  defineTool({
    name: "update_wireless_interface",
    title: "Update Wireless Interface",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates an existing wireless interface's settings (name, SSID, enabled state, etc.).",
    inputSchema: {
      name: z.string(),
      new_name: z.string().optional(),
      ssid: z.string().optional(),
      disabled: z.boolean().optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating wireless interface: name=${a.name}`);

      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (!interfaceType) return "Error: No wireless interface support detected on this device.";

      const count = await executeMikrotikCommand(
        `${interfaceType} print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `Wireless interface '${a.name}' not found.`;

      const cmd = new Cmd(`${interfaceType} set [find name="${a.name}"]`)
        .opt("name", a.new_name)
        .opt("ssid", a.ssid)
        .bool("disabled", a.disabled)
        .opt("comment", a.comment)
        .build();

      // No updates were supplied -> the command would just be the `set [find ...]` stem.
      if (!cmd.includes("=", cmd.indexOf("]"))) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update wireless interface: ${result}`;

      const targetName = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(
        `${interfaceType} print detail where name="${targetName}"`,
        ctx,
      );
      return `Wireless interface updated successfully:\n\n${details}`;
    },
  }),
];
