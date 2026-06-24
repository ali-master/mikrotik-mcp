/**
 * Network diagnostic & monitoring tools — `/ping`, `/tool ...`.
 *
 * Covers bounded diagnostics (ping, traceroute, bandwidth-test, DNS resolve)
 * plus netwatch host monitoring. Diagnostic runs are bounded by an explicit
 * `count`/`duration` so they terminate instead of streaming indefinitely.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const networkToolTools: ToolModule = [
  defineTool({
    name: "ping",
    title: "Ping",
    annotations: READ,
    description:
      "Sends ICMP echo requests to a host. Output reflects a single bounded run of `count` packets (1-100); it does not stream continuously.",
    inputSchema: {
      address: z.string().describe("Target host or IP to ping"),
      count: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(4)
        .describe("Number of echo requests (1-100)"),
      interface: z.string().optional().describe("Outgoing interface"),
      src_address: z.string().optional().describe("Source address to ping from"),
      size: z.number().int().optional().describe("Packet size in bytes"),
    },
    async handler(a, ctx) {
      ctx.info(`Pinging ${a.address} (count=${a.count})`);
      const cmd = new Cmd(`/ping ${a.address}`)
        .set("count", a.count)
        .opt("interface", a.interface)
        .opt("src-address", a.src_address)
        .opt("size", a.size)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to ping ${a.address}: ${result}`;
      return isEmpty(result) ? `No response from ${a.address}.` : `PING ${a.address}:\n\n${result}`;
    },
  }),

  defineTool({
    name: "traceroute",
    title: "Traceroute",
    annotations: READ,
    description:
      "Traces the network path to a host. traceroute can stream; output reflects a bounded run of `count` probes (keep count small).",
    inputSchema: {
      address: z.string().describe("Target host or IP to trace"),
      count: z
        .number()
        .int()
        .default(3)
        .describe("Number of probes per hop (keep small to bound the run)"),
      use_dns: z.boolean().optional().describe("Resolve hop addresses to names"),
    },
    async handler(a, ctx) {
      ctx.info(`Tracerouting ${a.address} (count=${a.count})`);
      const cmd = new Cmd(`/tool traceroute ${a.address}`)
        .set("count", a.count)
        .flag("use-dns", a.use_dns)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to traceroute ${a.address}: ${result}`;
      return isEmpty(result)
        ? `No route information for ${a.address}.`
        : `TRACEROUTE ${a.address}:\n\n${result}`;
    },
  }),

  defineTool({
    name: "bandwidth_test",
    title: "Bandwidth Test",
    annotations: READ,
    description:
      "Runs a throughput test against a target that must be running a bandwidth-test server. Output reflects a bounded run of `duration` seconds; it does not run indefinitely.",
    inputSchema: {
      address: z.string().describe("Target running a bandwidth-test server"),
      duration: z.number().int().default(5).describe("Test duration in seconds"),
      direction: z.enum(["receive", "transmit", "both"]).default("receive"),
      user: z.string().optional().describe("Username for the bandwidth-test server"),
      password: z.string().optional().describe("Password for the bandwidth-test server"),
      protocol: z.enum(["tcp", "udp"]).default("tcp"),
    },
    async handler(a, ctx) {
      ctx.info(
        `Bandwidth test to ${a.address} (duration=${a.duration}s, direction=${a.direction})`,
      );
      const cmd = new Cmd(`/tool bandwidth-test ${a.address}`)
        .set("duration", `${a.duration}s`)
        .set("direction", a.direction)
        .set("protocol", a.protocol)
        .opt("user", a.user)
        .opt("password", a.password)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to run bandwidth test to ${a.address}: ${result}`;
      return isEmpty(result)
        ? `No bandwidth test results for ${a.address}.`
        : `BANDWIDTH TEST:\n\n${result}`;
    },
  }),

  defineTool({
    name: "resolve_dns",
    title: "Resolve DNS",
    annotations: READ,
    description: "Resolves a DNS name to an address using the device's configured resolver.",
    inputSchema: {
      name: z.string().describe("DNS name to resolve, e.g. 'example.com'"),
      server: z
        .string()
        .optional()
        .describe(
          "Specific DNS server to query (informational; :resolve uses the system resolver)",
        ),
    },
    async handler(a, ctx) {
      ctx.info(`Resolving DNS name ${a.name}`);
      const result = await executeMikrotikCommand(`:put [:resolve "${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to resolve ${a.name}: ${result}`;
      return isEmpty(result)
        ? `Could not resolve ${a.name}.`
        : `DNS RESOLVE ${a.name}:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_netwatch",
    title: "Add Netwatch",
    annotations: WRITE,
    description:
      "Adds a netwatch entry that monitors a host and optionally runs scripts on up/down transitions.",
    inputSchema: {
      host: z.string().describe("Host to monitor"),
      interval: z.string().optional().describe("Probe interval, e.g. '00:00:10'"),
      timeout: z.string().optional().describe("Probe timeout, e.g. '00:00:01'"),
      up_script: z.string().optional().describe("Script to run when the host comes up"),
      down_script: z.string().optional().describe("Script to run when the host goes down"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding netwatch for host ${a.host}`);
      const cmd = new Cmd("/tool netwatch add")
        .set("host", a.host)
        .opt("interval", a.interval)
        .opt("timeout", a.timeout)
        .opt("up-script", a.up_script)
        .opt("down-script", a.down_script)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add netwatch: ${result}`;

      const details = await executeMikrotikCommand(
        `/tool netwatch print detail where host="${a.host}"`,
        ctx,
      );
      return details.trim()
        ? `Netwatch entry added successfully:\n\n${details}`
        : "Netwatch entry added but unable to verify.";
    },
  }),

  defineTool({
    name: "list_netwatch",
    title: "List Netwatch",
    annotations: READ,
    description: "Lists netwatch host-monitoring entries.",
    inputSchema: {
      host_filter: z.string().optional().describe("Partial host match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing netwatch entries");
      const filters: string[] = [];
      if (a.host_filter) filters.push(`host~"${a.host_filter}"`);
      const result = await executeMikrotikCommand(
        `/tool netwatch print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No netwatch entries found matching the criteria."
        : `NETWATCH:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_netwatch",
    title: "Get Netwatch",
    annotations: READ,
    description: "Gets detailed information about a specific netwatch entry.",
    inputSchema: { host: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting netwatch details for host ${a.host}`);
      const result = await executeMikrotikCommand(
        `/tool netwatch print detail where host="${a.host}"`,
        ctx,
      );
      return isEmpty(result)
        ? `Netwatch entry for '${a.host}' not found.`
        : `NETWATCH DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_netwatch",
    title: "Remove Netwatch",
    annotations: DESTRUCTIVE,
    description: "Removes a netwatch entry by host.",
    inputSchema: { host: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing netwatch for host ${a.host}`);
      const count = await executeMikrotikCommand(
        `/tool netwatch print count-only where host="${a.host}"`,
        ctx,
      );
      if (count.trim() === "0") return `Netwatch entry for '${a.host}' not found.`;

      const result = await executeMikrotikCommand(
        `/tool netwatch remove [find host="${a.host}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove netwatch: ${result}`;
      return `Netwatch entry for '${a.host}' removed successfully.`;
    },
  }),
];
