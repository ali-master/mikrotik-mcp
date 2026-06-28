/**
 * Offline regression tests for device-name resolution. These lock the rule that
 * targeting is EXACT (key first, then label) and can never collapse one device
 * onto a similarly-named one — e.g. "Ali Home" must never resolve to "home".
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { MikrotikConfigSchema } from "../src/config";
import { deviceDirectory, getConfig, resolveDeviceName, setConfig } from "../src/core/runtime";

const CONFIG = MikrotikConfigSchema.parse({
  defaultDevice: "home",
  devices: {
    home: { host: "192.168.7.1", port: 1986, description: "Home router" },
    netherlands: { host: "181.41.194.22", port: 1986, description: "Branch Netherlands router" },
    "Ali NL": { host: "191.101.113.113", port: 1996, description: "Ali NL" },
    "Ali Home": { host: "45.87.6.144", port: 1996, description: "Ali Home" },
  },
});

const original = getConfig();
afterEach(() => setConfig(original));

describe("resolveDeviceName", () => {
  test('"Ali Home" resolves to the Ali Home device, never "home"', () => {
    setConfig(CONFIG);
    const key = resolveDeviceName("Ali Home");
    expect(key).toBe("Ali Home");
    expect(getConfig().devices[key]?.host).toBe("45.87.6.144");
  });

  test('"home" still resolves to its own device', () => {
    setConfig(CONFIG);
    expect(resolveDeviceName("home")).toBe("home");
    expect(getConfig().devices.home?.host).toBe("192.168.7.1");
  });

  test("a free-text label resolves to the matching key (case-insensitive)", () => {
    setConfig(CONFIG);
    expect(resolveDeviceName("Home router")).toBe("home");
    expect(resolveDeviceName("branch netherlands router")).toBe("netherlands");
  });

  test("an undefined name falls back to the configured default", () => {
    setConfig(CONFIG);
    expect(resolveDeviceName(undefined)).toBe("home");
  });
});

describe("deviceDirectory", () => {
  test("lists every device with its target and marks the default", () => {
    setConfig(CONFIG);
    const dir = deviceDirectory();
    const ali = dir.find((d) => d.key === "Ali Home");
    expect(ali).toEqual({
      key: "Ali Home",
      label: "Ali Home",
      target: "45.87.6.144:1996",
      isDefault: false,
    });
    expect(dir.find((d) => d.key === "home")?.isDefault).toBe(true);
    // The two home-ish devices stay distinct targets.
    expect(dir.find((d) => d.key === "home")?.target).toBe("192.168.7.1:1986");
  });
});
