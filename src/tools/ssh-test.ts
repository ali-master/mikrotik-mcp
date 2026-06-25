/**
 * SSH connectivity test tools — three of them, from three different vantage
 * points. The descriptions are deliberately explicit about WHO does the
 * connecting so the model picks the right one:
 *
 *   • test_ssh_to_device  — the MCP HOST connects to a CONFIGURED device
 *                           (diagnose why a saved device won't respond).
 *   • test_ssh_to_host    — the MCP HOST connects to an ARBITRARY host:port
 *                           with supplied credentials (pre-flight before adding).
 *   • test_ssh_from_device — a RouterOS DEVICE connects OUT to a remote host
 *                           using its own SSH client (`/system ssh-exec`).
 *
 * The first two open a real SSH connection from the Node process running this
 * MCP server (not via the device command channel); the third runs on the device.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { getDevice, resolveDeviceName } from "../core/runtime";
import { parseKeyValues } from "../core/routeros-parse";
import { Cmd } from "../core/routeros";
import { MikroTikSSHClient } from "../ssh/client";

/** Open an SSH connection from the MCP host, run one read command, report. */
async function probe(
  opts: ConstructorParameters<typeof MikroTikSSHClient>[0],
  label: string,
  command: string,
): Promise<string> {
  const client = new MikroTikSSHClient(opts);
  const t0 = Date.now();
  try {
    const ok = await client.connect();
    if (!ok) {
      return `❌ SSH FAILED to ${label} — could not connect/authenticate: ${client.lastError ?? "unknown error"}`;
    }
    const connectMs = Date.now() - t0;
    let out: string;
    try {
      out = await client.run(command);
    } catch (e) {
      return `⚠️ Connected & authenticated to ${label} in ${connectMs}ms, but running '${command}' failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    const identity = parseKeyValues(out).name;
    return `✅ SSH OK to ${label} — connected & authenticated in ${connectMs}ms${identity ? ` (identity: ${identity})` : ""}.`;
  } finally {
    client.disconnect();
  }
}

export const sshTestTools: ToolModule = [
  defineTool({
    name: "test_ssh_to_device",
    title: "Test SSH to a Configured Device (from the MCP host)",
    annotations: READ,
    description:
      "Tests the SSH connection FROM THE MACHINE RUNNING THIS MCP SERVER to a CONFIGURED device, " +
      "using that device's stored host/port/credentials. Use this to diagnose why a saved device is " +
      "not responding — it confirms whether the MCP host can reach the device's SSH port AND " +
      "authenticate, and reports the connect latency and identity. Targets the selected/default device " +
      "(the `device` selector). NOTE: this opens a real SSH connection from the MCP host, not through " +
      "the usual command channel, and is SSH-only (a MAC-Telnet device has no SSH). To test an " +
      "UNSAVED host with ad-hoc credentials use test_ssh_to_host; to test SSH OUTBOUND from a router " +
      "use test_ssh_from_device. Returns OK/failed with the reason.",
    async handler(_a, ctx) {
      const name = resolveDeviceName(ctx.device);
      const dc = getDevice(name);
      if (dc.mac) {
        return `'${name}' is a MAC-Telnet device (reached by MAC ${dc.mac}) — it has no SSH connection to test. Use a tool over MAC-Telnet instead.`;
      }
      ctx.info(`Testing SSH from MCP host to configured device '${name}' (${dc.host}:${dc.port})`);
      return probe(
        {
          host: dc.host,
          port: dc.port,
          username: dc.username,
          password: dc.password,
          keyFilename: dc.keyFilename,
          privateKey: dc.privateKey,
          keyPassphrase: dc.keyPassphrase,
          timeoutMs: Math.min(dc.timeoutMs ?? 10_000, 10_000),
        },
        `'${name}' (${dc.host}:${dc.port})`,
        "/system identity print",
      );
    },
  }),

  defineTool({
    name: "test_ssh_to_host",
    title: "Test SSH to Any Host (from the MCP host)",
    annotations: READ,
    description:
      "Tests an SSH connection FROM THE MACHINE RUNNING THIS MCP SERVER to an ARBITRARY host:port with " +
      "the supplied credentials — a pre-flight check BEFORE adding a device to the config, or to verify " +
      "reachability/credentials for any SSH host. Confirms TCP reachability AND authentication and " +
      "reports the connect latency. Provide a `password` and/or a private-key path (`key_path`). NOTE: " +
      "this opens a real SSH connection from the MCP host. For a device that is ALREADY configured use " +
      "test_ssh_to_device; to test SSH outbound FROM a router use test_ssh_from_device. Returns " +
      "OK/failed with the reason.",
    inputSchema: {
      host: z.string().describe("Target IP or hostname"),
      port: z.number().int().min(1).max(65535).default(22),
      username: z.string(),
      password: z.string().optional().describe("Password auth (omit if using a key)"),
      key_path: z.string().optional().describe("Path (on the MCP host) to a private key file"),
      key_passphrase: z.string().optional(),
      command: z
        .string()
        .default("/system identity print")
        .describe("Command to run once connected (a harmless RouterOS read by default)"),
    },
    async handler(a, ctx) {
      ctx.info(`Testing SSH from MCP host to ${a.host}:${a.port} as ${a.username}`);
      return probe(
        {
          host: a.host,
          port: a.port,
          username: a.username,
          password: a.password,
          keyFilename: a.key_path,
          keyPassphrase: a.key_passphrase,
          timeoutMs: 10_000,
        },
        `${a.host}:${a.port}`,
        a.command,
      );
    },
  }),

  defineTool({
    name: "test_ssh_from_device",
    title: "Test SSH Outbound From a RouterOS Device",
    annotations: WRITE,
    description:
      "Tests SSH OUTBOUND FROM a RouterOS device to a remote host using the device's OWN SSH client " +
      "(`/system ssh-exec`) — i.e. the connection is made BY the router, not by the MCP host. Use this " +
      "to check whether a router can reach and log into another host over SSH (e.g. a jump path or " +
      "another router). The router's user must be able to authenticate to the target NON-interactively " +
      "(a stored key on the router) — a password-only target will prompt and time out. Runs the test " +
      "`command` on the remote and returns its output. To test the MCP HOST's connection to a device " +
      "instead, use test_ssh_to_device (configured) or test_ssh_to_host (ad-hoc). Returns the remote " +
      "command output or the device's error.",
    inputSchema: {
      host: z.string().describe("Remote host the ROUTER should SSH to"),
      port: z.number().int().min(1).max(65535).default(22),
      user: z.string().describe("Username on the remote host"),
      command: z
        .string()
        .default("/system identity print")
        .describe("Command to run on the remote host as the connectivity test"),
    },
    async handler(a, ctx) {
      ctx.info(`Testing SSH from this device out to ${a.host}:${a.port} as ${a.user}`);
      const cmd = new Cmd("/system ssh-exec")
        .set("address", a.host)
        .set("port", a.port)
        .set("user", a.user)
        .set("command", a.command)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      const t = result.trim();
      if (!t)
        return `Ran ssh-exec to ${a.host}:${a.port} — no output (the connection may have failed, or the command returned nothing).`;
      return `SSH-exec FROM this device to ${a.host}:${a.port} (user ${a.user}):\n\n${t}`;
    },
  }),
];
