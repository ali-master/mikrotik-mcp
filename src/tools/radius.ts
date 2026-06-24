/** RADIUS client — `/radius`. The router authenticates against external RADIUS servers. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";
import { redactSecrets } from "../utils";

export const radiusTools: ToolModule = [
  defineTool({
    name: "add_radius_server",
    title: "Add RADIUS Server",
    annotations: WRITE,
    description: "Adds a RADIUS server entry that the router uses to authenticate clients.",
    inputSchema: {
      address: z.string().describe("RADIUS server IP address or hostname"),
      secret: z.string().describe("Shared secret used with the RADIUS server"),
      service: z
        .string()
        .describe('Comma-separated services, e.g. "login,ppp,hotspot,wireless,dhcp,ipsec,dot1x"'),
      authentication_port: z.number().int().default(1812),
      accounting_port: z.number().int().default(1813),
      timeout: z.string().optional().describe('Request timeout, e.g. "300ms"'),
      src_address: z.string().optional(),
      realm: z.string().optional(),
      called_id: z.string().optional(),
      domain: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding RADIUS server: address=${a.address}, service=${a.service}`);
      const cmd = new Cmd("/radius add")
        .set("address", a.address)
        .set("secret", a.secret)
        .set("service", a.service)
        .opt("authentication-port", a.authentication_port)
        .opt("accounting-port", a.accounting_port)
        .opt("timeout", a.timeout)
        .opt("src-address", a.src_address)
        .opt("realm", a.realm)
        .opt("called-id", a.called_id)
        .opt("domain", a.domain)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add RADIUS server: ${result}`;

      const details = await executeMikrotikCommand(
        `/radius print detail where address="${a.address}"`,
        ctx,
      );
      return details.trim()
        ? `RADIUS server added successfully:\n\n${redactSecrets(details)}`
        : "RADIUS server creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_radius_servers",
    title: "List RADIUS Servers",
    annotations: READ,
    description: "Lists configured RADIUS servers.",
    inputSchema: {
      service_filter: z.string().optional().describe("Partial service match"),
      address_filter: z.string().optional().describe("Partial address match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing RADIUS servers");
      const filters: string[] = [];
      if (a.service_filter) filters.push(`service~"${a.service_filter}"`);
      if (a.address_filter) filters.push(`address~"${a.address_filter}"`);

      const result = await executeMikrotikCommand(`/radius print${whereClause(filters)}`, ctx);
      return isEmpty(result)
        ? "No RADIUS servers found matching the criteria."
        : `RADIUS SERVERS:\n\n${redactSecrets(result)}`;
    },
  }),

  defineTool({
    name: "get_radius_server",
    title: "Get RADIUS Server",
    annotations: READ,
    description: "Gets detailed information about a specific RADIUS server by its internal id.",
    inputSchema: {
      radius_id: z.string().describe("RADIUS entry internal .id, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting RADIUS server details: radius_id=${a.radius_id}`);
      const result = await executeMikrotikCommand(
        `/radius print detail where .id="${a.radius_id}"`,
        ctx,
      );
      return isEmpty(result)
        ? `RADIUS server '${a.radius_id}' not found.`
        : `RADIUS SERVER DETAILS:\n\n${redactSecrets(result)}`;
    },
  }),

  defineTool({
    name: "update_radius_server",
    title: "Update RADIUS Server",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates an existing RADIUS server entry.",
    inputSchema: {
      radius_id: z.string().describe("RADIUS entry internal .id, e.g. '*1'"),
      address: z.string().optional(),
      secret: z.string().optional(),
      service: z.string().optional(),
      authentication_port: z.number().int().optional(),
      accounting_port: z.number().int().optional(),
      timeout: z.string().optional(),
      src_address: z.string().optional(),
      realm: z.string().optional(),
      called_id: z.string().optional(),
      domain: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating RADIUS server: radius_id=${a.radius_id}`);
      const cmd = new Cmd(`/radius set ${a.radius_id}`)
        .opt("address", a.address)
        .opt("secret", a.secret)
        .opt("service", a.service)
        .opt("authentication-port", a.authentication_port)
        .opt("accounting-port", a.accounting_port)
        .opt("timeout", a.timeout)
        .opt("src-address", a.src_address)
        .opt("realm", a.realm)
        .opt("called-id", a.called_id)
        .opt("domain", a.domain)
        .opt("comment", a.comment)
        .bool("disabled", a.disabled)
        .build();

      // No updates supplied -> the command would just be the `set <id>` stem.
      if (!cmd.includes("=")) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update RADIUS server: ${result}`;

      const details = await executeMikrotikCommand(
        `/radius print detail where .id="${a.radius_id}"`,
        ctx,
      );
      return `RADIUS server updated successfully:\n\n${redactSecrets(details)}`;
    },
  }),

  defineTool({
    name: "remove_radius_server",
    title: "Remove RADIUS Server",
    annotations: DESTRUCTIVE,
    description: "Removes a RADIUS server entry.",
    inputSchema: {
      radius_id: z.string().describe("RADIUS entry internal .id, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing RADIUS server: radius_id=${a.radius_id}`);
      const count = await executeMikrotikCommand(
        `/radius print count-only where .id="${a.radius_id}"`,
        ctx,
      );
      if (count.trim() === "0") return `RADIUS server '${a.radius_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/radius remove [find .id="${a.radius_id}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove RADIUS server: ${result}`;
      return `RADIUS server '${a.radius_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_radius_server",
    title: "Enable RADIUS Server",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a RADIUS server entry.",
    inputSchema: {
      radius_id: z.string().describe("RADIUS entry internal .id, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Enabling RADIUS server: radius_id=${a.radius_id}`);
      const result = await executeMikrotikCommand(
        `/radius enable [find .id="${a.radius_id}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to enable RADIUS server: ${result}`;
      return `RADIUS server '${a.radius_id}' enabled successfully.`;
    },
  }),

  defineTool({
    name: "disable_radius_server",
    title: "Disable RADIUS Server",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a RADIUS server entry.",
    inputSchema: {
      radius_id: z.string().describe("RADIUS entry internal .id, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Disabling RADIUS server: radius_id=${a.radius_id}`);
      const result = await executeMikrotikCommand(
        `/radius disable [find .id="${a.radius_id}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to disable RADIUS server: ${result}`;
      return `RADIUS server '${a.radius_id}' disabled successfully.`;
    },
  }),

  defineTool({
    name: "get_radius_incoming",
    title: "Get RADIUS Incoming",
    annotations: READ,
    description: "Gets the RADIUS incoming (Change of Authorization / CoA) settings.",
    async handler(_a, ctx) {
      ctx.info("Getting RADIUS incoming (CoA) settings");
      const result = await executeMikrotikCommand("/radius incoming print", ctx);
      return isEmpty(result)
        ? "No RADIUS incoming settings found."
        : `RADIUS INCOMING (CoA):\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_radius_incoming",
    title: "Set RADIUS Incoming",
    annotations: WRITE_IDEMPOTENT,
    description: "Configures RADIUS incoming (Change of Authorization / CoA) settings.",
    inputSchema: {
      accept: z.boolean().optional().describe("Whether to accept incoming CoA requests"),
      port: z.number().int().optional().describe("UDP port to listen on for CoA requests"),
    },
    async handler(a, ctx) {
      ctx.info("Setting RADIUS incoming (CoA) settings");
      const cmd = new Cmd("/radius incoming set")
        .bool("accept", a.accept)
        .opt("port", a.port)
        .build();

      // No updates supplied -> the command would just be the `set` stem.
      if (!cmd.includes("=")) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to set RADIUS incoming: ${result}`;

      const details = await executeMikrotikCommand("/radius incoming print", ctx);
      return `RADIUS incoming updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "reset_radius_counters",
    title: "Reset RADIUS Counters",
    annotations: DESTRUCTIVE,
    description: "Resets the RADIUS request/response counters.",
    async handler(_a, ctx) {
      ctx.info("Resetting RADIUS counters");
      const result = await executeMikrotikCommand("/radius reset-counters", ctx);
      if (looksLikeError(result)) return `Failed to reset RADIUS counters: ${result}`;
      return "RADIUS counters reset.";
    },
  }),
];
