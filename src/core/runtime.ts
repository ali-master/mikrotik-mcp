/**
 * Process-wide runtime state: the active configuration, set once at startup.
 *
 * Tool handlers reach the connection details through `getConfig()` instead of
 * receiving them as a parameter, mirroring the module-level `config.mikrotik_config`
 * singleton in the original Python implementation. This keeps the 169 tool
 * signatures focused on their own arguments.
 */
import { MikrotikConfigSchema  } from "../config";
import type {MikrotikConfig} from "../config";

let active: MikrotikConfig = MikrotikConfigSchema.parse({});

export function setConfig(cfg: MikrotikConfig): void {
  active = cfg;
}

export function getConfig(): MikrotikConfig {
  return active;
}
