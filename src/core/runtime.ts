/**
 * Process-wide runtime state: the active configuration, set once at startup.
 *
 * Tool handlers reach connection details through `getDevice()` instead of
 * receiving them as parameters. With named multi-device support, the device a
 * call targets is carried on the ToolContext and resolved here.
 */
import type { MikrotikConfig, DeviceConfig } from "../config";
import { MikrotikConfigSchema } from "../config";

let active: MikrotikConfig = MikrotikConfigSchema.parse({});

export function setConfig(cfg: MikrotikConfig): void {
  active = cfg;
}

export function getConfig(): MikrotikConfig {
  return active;
}

/** Names of every configured device, plus which one is the default. */
export function listDevices(): { names: string[]; default: string } {
  return { names: Object.keys(active.devices), default: active.defaultDevice };
}

/** Resolve a (possibly undefined) device name to a concrete, existing name. */
export function resolveDeviceName(name?: string): string {
  if (name && name in active.devices) return name;
  return active.defaultDevice in active.devices
    ? active.defaultDevice
    : (Object.keys(active.devices)[0] ?? active.defaultDevice);
}

/**
 * Return the connection config for a device by name (or the default when
 * `name` is undefined). Throws if an explicit, unknown name is given.
 */
export function getDevice(name?: string): DeviceConfig {
  if (name && !(name in active.devices)) {
    throw new Error(
      `Unknown device '${name}'. Configured devices: ${Object.keys(active.devices).join(", ")}`,
    );
  }
  const key = resolveDeviceName(name);
  const dc = active.devices[key];
  if (!dc) throw new Error(`No device configuration available for '${key}'.`);
  return dc;
}
