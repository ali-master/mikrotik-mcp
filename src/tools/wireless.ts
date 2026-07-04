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
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd, quoteValue } from "../core/routeros";
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
      "Creates a wireless interface (`/interface wifi`, `/interface wifiwave2`, `/interface wireless`, or `/interface wlan` — auto-detected per device). " +
      "Use to add a new AP or station interface to the device. " +
      "On RouterOS v7 accepts name, ssid, disabled, and comment; on v6/legacy also requires radio_name (e.g. `wlan1`) and optionally accepts mode (default `ap-bridge`), frequency, band, channel_width, and security_profile. " +
      "To modify an existing interface use update_wireless_interface; to see current interfaces use list_wireless_interfaces. " +
      "Returns the created interface's full detail print including its `.id`.",
    inputSchema: {
      name: z.string(),
      ssid: z.string().optional(),
      disabled: z.boolean().default(false),
      comment: z.string().optional(),
      radio_name: z
        .string()
        .optional()
        .describe("Required for legacy wireless systems, e.g. 'wlan1'"),
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
      mtu: z.number().int().optional().describe("Interface MTU in bytes"),
      arp: z
        .enum(["disabled", "enabled", "proxy-arp", "reply-only", "local-proxy-arp"])
        .optional()
        .describe("ARP mode for the interface"),
      hide_ssid: z
        .boolean()
        .optional()
        .describe("Legacy: do not broadcast the SSID in beacons (AP modes)"),
      wireless_protocol: z
        .string()
        .optional()
        .describe("Legacy: wireless protocol, e.g. '802.11', 'nv2', 'nstreme'"),
      scan_list: z
        .string()
        .optional()
        .describe("Legacy: frequencies/ranges to scan (e.g. 'default' or '5180-5320')"),
      frequency_mode: z
        .enum(["manual-txpower", "regulatory-domain", "superchannel"])
        .optional()
        .describe("Legacy: regulatory frequency mode"),
      country: z
        .string()
        .optional()
        .describe("Legacy: regulatory country setting (e.g. 'united states')"),
      antenna_gain: z
        .number()
        .int()
        .optional()
        .describe("Legacy: antenna gain in dBi used for tx-power calculations"),
      wds_mode: z
        .enum(["disabled", "dynamic", "dynamic-mesh", "static", "static-mesh"])
        .optional()
        .describe("Legacy: WDS mode"),
      wds_default_bridge: z
        .string()
        .optional()
        .describe("Legacy: bridge that dynamic WDS interfaces are added to"),
      default_authentication: z
        .boolean()
        .optional()
        .describe("Legacy: allow clients not in the access-list to authenticate"),
      default_forwarding: z
        .boolean()
        .optional()
        .describe("Legacy: allow client-to-client forwarding by default"),
      tx_power: z.number().int().optional().describe("Legacy: manual transmit power in dBm"),
      tx_power_mode: z
        .enum(["default", "card-rates", "all-rates-fixed", "manual-table"])
        .optional()
        .describe("Legacy: how tx-power is determined"),
      distance: z
        .string()
        .optional()
        .describe("Legacy: link distance ('dynamic', 'indoors', or a km value)"),
      disconnect_timeout: z
        .string()
        .optional()
        .describe("Legacy: time before a non-responding client is disconnected"),
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
          .opt("mtu", a.mtu)
          .opt("arp", a.arp)
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
          .opt("mtu", a.mtu)
          .opt("arp", a.arp)
          .bool("hide-ssid", a.hide_ssid)
          .opt("wireless-protocol", a.wireless_protocol)
          .opt("scan-list", a.scan_list)
          .opt("frequency-mode", a.frequency_mode)
          .opt("country", a.country)
          .opt("antenna-gain", a.antenna_gain)
          .opt("wds-mode", a.wds_mode)
          .opt("wds-default-bridge", a.wds_default_bridge)
          .bool("default-authentication", a.default_authentication)
          .bool("default-forwarding", a.default_forwarding)
          .opt("tx-power", a.tx_power)
          .opt("tx-power-mode", a.tx_power_mode)
          .opt("distance", a.distance)
          .opt("disconnect-timeout", a.disconnect_timeout)
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
    description:
      "Lists all wireless interfaces (`/interface wifi`, `/interface wifiwave2`, `/interface wireless`, `/interface wlan`) — probes every supported command path and aggregates results. " +
      "Filters by name_filter (substring match), disabled_only, or running_only. " +
      "For full property detail on a single interface use get_wireless_interface; to see currently connected clients use get_wireless_registration_table. " +
      "Falls back to `/interface print` with debugging info when no wireless interfaces match, to help identify the correct path on the device.",
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
        if (filters.length) cmd += ` where ${filters.join(" and ")}`;

        const result = await executeMikrotikCommand(cmd, ctx);

        if (result && result.trim() !== "" && !commandUnsupported(result)) {
          workingTypes.push(interfaceType);
          allResults.push(`=== ${interfaceType.toUpperCase()} ===\n${result}`);
        }
      }

      if (allResults.length) {
        return `WIRELESS INTERFACES:\n\n${allResults.join("\n\n")}`;
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
    title: "Get Wireless Interface Details",
    annotations: READ,
    description:
      "Retrieves the full detail of one named wireless interface (`<auto-detected path> print detail where name=...`), " +
      "probing `/interface wifi`, `/interface wifiwave2`, `/interface wireless`, and `/interface wlan` in order. " +
      "Use when you need all properties of a single interface; for a summary of all interfaces use list_wireless_interfaces. " +
      "Returns the complete property set for the named interface, or an error if not found.",
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
    description:
      "Permanently deletes a named wireless interface (`<auto-detected path> remove [find name=...]`). " +
      "Verifies the interface exists first (count-only check) and returns an error if not found. " +
      "This action is irreversible — to keep the interface but stop traffic use disable_wireless_interface; " +
      "for property changes only use update_wireless_interface.",
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
    description:
      "Enables a named wireless interface that is currently disabled (`<auto-detected path> enable [find name=...]`). " +
      "Idempotent — safe to call on an already-enabled interface. " +
      "For the reverse operation use disable_wireless_interface; to change other settings at the same time use update_wireless_interface. " +
      "Obtain the interface name from list_wireless_interfaces.",
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
    description:
      "Disables a named wireless interface without removing it (`<auto-detected path> disable [find name=...]`). " +
      "Idempotent — safe to call on an already-disabled interface. " +
      "For the reverse operation use enable_wireless_interface; to delete the interface permanently use remove_wireless_interface. " +
      "Obtain the interface name from list_wireless_interfaces.",
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
    title: "Scan for Nearby Wireless Networks",
    annotations: READ,
    description:
      "Scans for visible nearby wireless networks/SSIDs/APs in range (`<auto-detected path> scan <interface> duration=<n>`). " +
      "Use to discover external networks — not to list connected clients. " +
      "For currently associated client stations use get_wireless_registration_table instead. " +
      "`interface` is the local wireless interface name to scan from (e.g. `wlan1`); `duration` is scan time in seconds (default 5). " +
      "Returns raw scan output from the device.",
    inputSchema: {
      interface: z.string(),
      duration: z.number().int().default(5),
    },
    async handler(a, ctx) {
      ctx.info(`Scanning wireless networks on interface: ${a.interface}`);

      const interfaceType = await detectWirelessInterfaceType(ctx);
      if (!interfaceType) return "Error: No wireless interface support detected on this device.";

      const scanCmd = new Cmd(`${interfaceType} scan`)
        .raw(quoteValue(a.interface))
        .set("duration", a.duration)
        .build();

      const result = await executeMikrotikCommand(scanCmd, ctx);
      if (looksLikeError(result)) return `Failed to scan wireless networks: ${result}`;

      return `WIRELESS NETWORK SCAN RESULTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_wireless_registration_table",
    title: "Get Wireless Registration Table (Connected Clients)",
    annotations: READ,
    description:
      "Retrieves the wireless registration table — the list of client stations currently associated to this AP (`<auto-detected path> registration-table print [where interface=...]`). " +
      "Each row is an actively connected wireless client with its MAC address, signal strength, and statistics. " +
      "To discover nearby external APs/SSIDs instead use scan_wireless_networks. " +
      "Optionally filter by interface name; omit to return all clients across all wireless interfaces.",
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
    title: "Check Wireless Support and Detected Interface Type",
    annotations: READ,
    description:
      "Diagnoses which wireless subsystem the device supports by running `/system resource print`, `/system package print`, `/interface print`, " +
      "and probing each wireless command path in priority order (`/interface wifi` → `/interface wifiwave2` → `/interface wireless` → `/interface wlan`). " +
      "Returns RouterOS version, installed packages, all interfaces, and the detected wireless command path. " +
      "Use this before other wireless tools when the device's wireless capability is unknown, or when wireless tools are returning unsupported/bad-command errors.",
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
    title: "Create Wireless Security Profile (Legacy v6 Only — Not Implemented)",
    annotations: WRITE,
    description:
      "Stub for creating a `/interface wireless security-profiles` entry — a RouterOS v6 concept that does not exist in v7. " +
      "On RouterOS v7 devices (`/interface wifi` or `/interface wifiwave2`) always returns a not-supported message; security is configured directly on the interface. " +
      "On v6 this is also not implemented and returns an error. " +
      "For v6 interface creation with a security profile use create_wireless_interface (security_profile arg); for v7, security is configured directly on the interface but is not exposed by this server's wireless tools.",
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
    title: "List Wireless Security Profiles (Legacy v6 Only — Not Implemented)",
    annotations: READ,
    description:
      "Stub for listing `/interface wireless security-profiles` entries — a RouterOS v6 concept that does not exist in v7. " +
      "On RouterOS v7 devices always returns a not-supported message; on v6 also not implemented. " +
      "To inspect current wireless interface configuration (including security) use list_wireless_interfaces or get_wireless_interface instead.",
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
    title: "Get Wireless Security Profile (Legacy v6 Only — Not Implemented)",
    annotations: READ,
    description:
      "Stub for retrieving a named `/interface wireless security-profiles` entry — a RouterOS v6 concept that does not exist in v7. " +
      "On RouterOS v7 devices always returns a not-supported message; on v6 also not implemented. " +
      "Use get_wireless_interface to inspect the security settings on a v7 wireless interface instead.",
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
    title: "Remove Wireless Security Profile (Legacy v6 Only — Not Implemented)",
    annotations: DESTRUCTIVE,
    description:
      "Stub for deleting a named `/interface wireless security-profiles` entry — a RouterOS v6 concept that does not exist in v7. " +
      "On RouterOS v7 devices always returns a not-supported message; on v6 also not implemented. " +
      "To delete a wireless interface entirely use remove_wireless_interface; to change security settings use update_wireless_interface.",
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
    title: "Assign Security Profile to Wireless Interface (Legacy v6 Only — Not Implemented)",
    annotations: WRITE,
    description:
      "Stub for assigning a named security profile to a v6 `/interface wireless` interface — a RouterOS v6 concept that does not exist in v7. " +
      "On RouterOS v7 devices always returns a not-supported message because security is set directly on the interface. " +
      "On v6 also not implemented. " +
      "To update a wireless interface's settings on supported versions use update_wireless_interface.",
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
    title: "Create Wireless Access List Entry (Legacy v6 Only — Not Implemented)",
    annotations: WRITE,
    description:
      "Stub for creating a `/interface wireless access-list` MAC-address filtering entry — a RouterOS v6 concept. " +
      "On RouterOS v7 devices always returns a not-supported message; use firewall rules or other access-control methods instead. " +
      "On v6 also not implemented. " +
      "For v7 client filtering use create_filter_rule targeting the wireless interface.",
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
    title: "List Wireless Access List Entries (Legacy v6 Only — Not Implemented)",
    annotations: READ,
    description:
      "Stub for listing `/interface wireless access-list` entries — a RouterOS v6 MAC-based client filtering concept. " +
      "On RouterOS v7 devices always returns a not-supported message; on v6 also not implemented. " +
      "For connected client visibility use get_wireless_registration_table; for firewall-based access control use list_filter_rules.",
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
    title: "Remove Wireless Access List Entry (Legacy v6 Only — Not Implemented)",
    annotations: DESTRUCTIVE,
    description:
      "Stub for removing a `/interface wireless access-list` entry by ID — a RouterOS v6 concept. " +
      "On RouterOS v7 devices always returns a not-supported message; on v6 also not implemented. " +
      "The entry_id would take the `.id` from list_wireless_access_list if that were implemented. " +
      "For v7 access control use list_filter_rules and remove_filter_rule instead.",
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
    title: "Update Wireless Interface Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates settings on an existing named wireless interface (`<auto-detected path> set [find name=...] ...`). " +
      "Supports renaming (new_name), changing SSID, toggling disabled state, and updating comment. " +
      "Verifies the interface exists before applying; returns 'No updates specified.' if no optional fields are provided. " +
      "To only enable or disable the interface prefer enable_wireless_interface or disable_wireless_interface; " +
      "to create a new interface use create_wireless_interface; to delete one use remove_wireless_interface. " +
      "Returns the updated interface's full detail print.",
    inputSchema: {
      name: z.string(),
      new_name: z.string().optional(),
      ssid: z.string().optional(),
      disabled: z.boolean().optional(),
      comment: z.string().optional(),
      mtu: z.number().int().optional().describe("Interface MTU in bytes"),
      arp: z
        .enum(["disabled", "enabled", "proxy-arp", "reply-only", "local-proxy-arp"])
        .optional()
        .describe("ARP mode for the interface"),
      hide_ssid: z
        .boolean()
        .optional()
        .describe("Legacy: do not broadcast the SSID in beacons (AP modes)"),
      wireless_protocol: z
        .string()
        .optional()
        .describe("Legacy: wireless protocol, e.g. '802.11', 'nv2', 'nstreme'"),
      scan_list: z
        .string()
        .optional()
        .describe("Legacy: frequencies/ranges to scan (e.g. 'default' or '5180-5320')"),
      frequency: z.string().optional().describe("Legacy: operating frequency in MHz"),
      band: z.string().optional().describe("Legacy: band, e.g. '2ghz-b/g/n' or '5ghz-a/n/ac'"),
      channel_width: z
        .enum(["20mhz", "40mhz", "80mhz", "160mhz", "20/40mhz-eC", "20/40mhz-Ce"])
        .optional()
        .describe("Legacy: channel width"),
      frequency_mode: z
        .enum(["manual-txpower", "regulatory-domain", "superchannel"])
        .optional()
        .describe("Legacy: regulatory frequency mode"),
      country: z
        .string()
        .optional()
        .describe("Legacy: regulatory country setting (e.g. 'united states')"),
      antenna_gain: z
        .number()
        .int()
        .optional()
        .describe("Legacy: antenna gain in dBi used for tx-power calculations"),
      wds_mode: z
        .enum(["disabled", "dynamic", "dynamic-mesh", "static", "static-mesh"])
        .optional()
        .describe("Legacy: WDS mode"),
      wds_default_bridge: z
        .string()
        .optional()
        .describe("Legacy: bridge that dynamic WDS interfaces are added to"),
      default_authentication: z
        .boolean()
        .optional()
        .describe("Legacy: allow clients not in the access-list to authenticate"),
      default_forwarding: z
        .boolean()
        .optional()
        .describe("Legacy: allow client-to-client forwarding by default"),
      tx_power: z.number().int().optional().describe("Legacy: manual transmit power in dBm"),
      tx_power_mode: z
        .enum(["default", "card-rates", "all-rates-fixed", "manual-table"])
        .optional()
        .describe("Legacy: how tx-power is determined"),
      distance: z
        .string()
        .optional()
        .describe("Legacy: link distance ('dynamic', 'indoors', or a km value)"),
      disconnect_timeout: z
        .string()
        .optional()
        .describe("Legacy: time before a non-responding client is disconnected"),
      security_profile: z
        .string()
        .optional()
        .describe("Legacy: name of the security profile to apply"),
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
        .opt("mtu", a.mtu)
        .opt("arp", a.arp)
        .bool("hide-ssid", a.hide_ssid)
        .opt("wireless-protocol", a.wireless_protocol)
        .opt("scan-list", a.scan_list)
        .opt("frequency", a.frequency)
        .opt("band", a.band)
        .opt("channel-width", a.channel_width)
        .opt("frequency-mode", a.frequency_mode)
        .opt("country", a.country)
        .opt("antenna-gain", a.antenna_gain)
        .opt("wds-mode", a.wds_mode)
        .opt("wds-default-bridge", a.wds_default_bridge)
        .bool("default-authentication", a.default_authentication)
        .bool("default-forwarding", a.default_forwarding)
        .opt("tx-power", a.tx_power)
        .opt("tx-power-mode", a.tx_power_mode)
        .opt("distance", a.distance)
        .opt("disconnect-timeout", a.disconnect_timeout)
        .opt("security-profile", a.security_profile)
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
