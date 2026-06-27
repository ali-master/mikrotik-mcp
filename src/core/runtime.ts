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

/**
 * Map a device's free-text `description` (the label shown to the AI, e.g.
 * "Ali Home") to its config key, case-insensitively. Lets a tool be targeted by
 * the friendly label as well as the key. Returns undefined when no label matches.
 */
function deviceKeyForLabel(name: string): string | undefined {
  const target = name.trim().toLowerCase();
  for (const [key, dc] of Object.entries(active.devices)) {
    if (dc.description && dc.description.trim().toLowerCase() === target) return key;
  }
  return undefined;
}

/**
 * Distinct device labels (`description`s) that can ALSO be used to target a
 * device — a non-empty description that isn't already a device key. These are
 * added to the `device` selector enum so the AI may pass either the key or the
 * friendly label.
 */
export function deviceLabels(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [key, dc] of Object.entries(active.devices)) {
    const label = dc.description?.trim();
    if (label && label !== key && !(label in active.devices) && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

/**
 * Resolve a (possibly undefined) device name to a concrete, existing config key.
 * Accepts a config key OR a device's free-text label; falls back to the default.
 */
export function resolveDeviceName(name?: string): string {
  if (name) {
    if (name in active.devices) return name;
    const byLabel = deviceKeyForLabel(name);
    if (byLabel) return byLabel;
  }
  return active.defaultDevice in active.devices
    ? active.defaultDevice
    : (Object.keys(active.devices)[0] ?? active.defaultDevice);
}

/**
 * Return the connection config for a device by key or label (or the default when
 * `name` is undefined). Throws if an explicit name matches neither a key nor a
 * label.
 */
export function getDevice(name?: string): DeviceConfig {
  if (name && !(name in active.devices) && !deviceKeyForLabel(name)) {
    throw new Error(
      `Unknown device '${name}'. Configured devices: ${Object.keys(active.devices).join(", ")}`,
    );
  }
  const key = resolveDeviceName(name);
  const dc = active.devices[key];
  if (!dc) throw new Error(`No device configuration available for '${key}'.`);
  return dc;
}
