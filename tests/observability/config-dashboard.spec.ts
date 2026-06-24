/**
 * Dashboard configuration layering (Vitest) — defaults, CLI flags, env vars and
 * the config-file `dashboard` block. `loadConfig(argv)` is pure w.r.t. argv; env
 * is set/cleared around the env case.
 */
import { afterEach, describe, it, expect } from "vite-plus/test";
import { DEFAULT_DASHBOARD_DB, loadConfig } from "../../src/config";

const ENV_KEYS = [
  "MIKROTIK_DASHBOARD__ENABLED",
  "MIKROTIK_DASHBOARD__PORT",
  "MIKROTIK_DASHBOARD__CAPTURE_BODY",
  "MIKROTIK_DASHBOARD__TOKEN",
];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("dashboard config", () => {
  it("defaults to disabled with sensible values", () => {
    const cfg = loadConfig([]);
    expect(cfg.dashboard.enabled).toBe(false);
    expect(cfg.dashboard.host).toBe("0.0.0.0"); // LAN-reachable by default
    expect(cfg.dashboard.port).toBe(9090);
    expect(cfg.dashboard.captureBody).toBe(true);
    expect(cfg.dashboard.maxEvents).toBe(100_000);
    expect(cfg.dashboard.dbPath).toBe(DEFAULT_DASHBOARD_DB);
    expect(cfg.dashboard.dbPath).toMatch(/[/\\]\.mikrotik-mcp[/\\]events\.db$/);
  });

  it("a bare --dashboard flag enables it, and flags override fields", () => {
    const cfg = loadConfig([
      "--dashboard",
      "--dashboard-port",
      "7777",
      "--dashboard-db",
      ":memory:",
      "--dashboard-capture-body",
      "false",
      "--dashboard-max-events",
      "500",
      "--dashboard-token",
      "s3cr3t",
    ]);
    expect(cfg.dashboard.enabled).toBe(true);
    expect(cfg.dashboard.port).toBe(7777);
    expect(cfg.dashboard.dbPath).toBe(":memory:");
    expect(cfg.dashboard.captureBody).toBe(false);
    expect(cfg.dashboard.maxEvents).toBe(500);
    expect(cfg.dashboard.token).toBe("s3cr3t");
  });

  it("reads env vars when no flags are given", () => {
    process.env.MIKROTIK_DASHBOARD__ENABLED = "true";
    process.env.MIKROTIK_DASHBOARD__PORT = "8123";
    process.env.MIKROTIK_DASHBOARD__CAPTURE_BODY = "false";
    process.env.MIKROTIK_DASHBOARD__TOKEN = "tok";
    const cfg = loadConfig([]);
    expect(cfg.dashboard.enabled).toBe(true);
    expect(cfg.dashboard.port).toBe(8123);
    expect(cfg.dashboard.captureBody).toBe(false);
    expect(cfg.dashboard.token).toBe("tok");
  });

  it("a config-file dashboard block overrides env/flags", () => {
    const inline = JSON.stringify({
      devices: { default: { host: "10.0.0.1" } },
      dashboard: { enabled: true, port: 9999, maxBodyBytes: 4096 },
    });
    const cfg = loadConfig(["--devices", inline, "--dashboard-port", "1111"]);
    expect(cfg.dashboard.enabled).toBe(true);
    expect(cfg.dashboard.port).toBe(9999); // file wins over the --dashboard-port flag
    expect(cfg.dashboard.maxBodyBytes).toBe(4096);
  });
});
