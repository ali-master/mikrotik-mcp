/**
 * Library entry point — use the server programmatically instead of via the CLI.
 *
 * ```ts
 * import { createServer, loadConfig, setConfig } from "@usex/mikrotik-mcp";
 * setConfig(loadConfig());
 * const { server } = createServer();
 * await server.connect(myTransport);
 * ```
 */
export {
  type DeviceConfig,
  DeviceConfigSchema,
  loadConfig,
  type MikrotikConfig,
  MikrotikConfigSchema,
} from "./config";
export { executeMikrotikCommand } from "./core/connector";
export { type ToolContext } from "./core/context";
export {
  defineTool,
  type RegisterableTool,
  registerTools,
  type ToolModule,
} from "./core/registry";
export { getConfig, getDevice, listDevices, resolveDeviceName, setConfig } from "./core/runtime";
export { createServer } from "./server";
export { MikroTikSSHClient } from "./ssh/client";
export { getSafeModeManager, SafeModeManager } from "./ssh/safe-mode";
export { allToolModules } from "./tools";
export { SERVER_NAME, VERSION } from "./version";
