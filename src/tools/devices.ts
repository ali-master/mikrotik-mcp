/**
 * Device inventory — lists the MikroTik routers this server is configured to
 * reach. This is server-side metadata (not a RouterOS command), so it never
 * opens an SSH connection and never exposes passwords or keys.
 *
 * The AI uses it to discover device names to pass as the `device` argument on
 * other tools — essential for cross-device work like building a tunnel between
 * two routers.
 */
import type { ToolModule } from "../core/registry";
import { READ, defineTool } from "../core/registry";
import { listDevices, getConfig } from "../core/runtime";

export const deviceTools: ToolModule = [
  defineTool({
    name: "list_mikrotik_devices",
    title: "List Configured MikroTik Devices",
    annotations: READ,
    description:
      "List all MikroTik devices registered in this server's configuration (server-side metadata — no RouterOS command is run, no SSH connection is opened). " +
      "Use this to discover the exact device name strings required by the `device` argument on every other tool, especially when working across multiple routers (e.g. building a tunnel between two devices). " +
      "Returns each device's name, username, host, port, auth method (key / password / none), optional description, and which entry is the default. " +
      "This name → host:port mapping is FIXED for the life of the server process — it does NOT change mid-session, so a given device name always reaches the same physical router. " +
      "Call this to verify the exact target before any write/destructive change when several routers are configured. " +
      "Credentials and private-key material are never included in the output.",
    handler(_a, ctx) {
      ctx.info("Listing configured MikroTik devices");
      const { names, default: def } = listDevices();
      const { devices } = getConfig();
      const lines = names.map((name) => {
        const d = devices[name];
        const tag = name === def ? " (default)" : "";
        const auth = d.keyFilename || d.privateKey ? "key" : d.password ? "password" : "none";
        const desc = d.description ? ` — ${d.description}` : "";
        return `• ${name}${tag}: ${d.username}@${d.host}:${d.port} [auth: ${auth}]${desc}`;
      });
      return `CONFIGURED MIKROTIK DEVICES (${names.length}):\n\n${lines.join("\n")}`;
    },
  }),
];
