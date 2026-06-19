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
    title: "List Devices",
    annotations: READ,
    description:
      "Lists the configured MikroTik devices (name, host, description) and which is the default. " +
      "Pass a device's name as the `device` argument on any other tool to target it. Secrets are never shown.",
    handler(_a, ctx) {
      ctx.info("Listing configured MikroTik devices");
      const { names, default: def } = listDevices();
      const { devices } = getConfig();
      const lines = names.map((name) => {
        const d = devices[name];
        const tag = name === def ? " (default)" : "";
        const auth =
          d.keyFilename || d.privateKey
            ? "key"
            : d.password
              ? "password"
              : "none";
        const desc = d.description ? ` — ${d.description}` : "";
        return `• ${name}${tag}: ${d.username}@${d.host}:${d.port} [auth: ${auth}]${desc}`;
      });
      return `CONFIGURED MIKROTIK DEVICES (${names.length}):\n\n${lines.join("\n")}`;
    },
  }),
];
