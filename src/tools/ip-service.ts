/**
 * IP management services — `/ip service`.
 *
 * The built-in management service ports (telnet, ftp, www, ssh, www-ssl, api,
 * api-ssl, winbox). Useful for hardening: restrict ports/source addresses or
 * disable the insecure services (telnet/ftp/www).
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const ipServiceTools: ToolModule = [
  defineTool({
    name: "list_ip_services",
    title: "List IP Services",
    annotations: READ,
    description:
      "Lists the management services (telnet, ftp, www, ssh, api, winbox, …) and their state.",
    async handler(_a, ctx) {
      ctx.info("Listing IP services");
      const result = await executeMikrotikCommand("/ip service print", ctx);
      return isEmpty(result) ? "No IP services found." : `IP SERVICES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ip_service",
    title: "Get IP Service",
    annotations: READ,
    description: "Gets detailed information about a specific management service.",
    inputSchema: {
      name: z.string().describe("Service name, e.g. 'ssh', 'www', 'winbox'"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting IP service details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ip service print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `IP service '${a.name}' not found.`
        : `IP SERVICE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_ip_service",
    title: "Set IP Service",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates a management service's port, allowed source addresses, certificate, or enabled state.",
    inputSchema: {
      name: z.string().describe("Service name to update, e.g. 'ssh'"),
      port: z.number().int().optional().describe("Listening port"),
      address: z.string().optional().describe("Allowed source subnets, comma-separated"),
      disabled: z.boolean().optional().describe("Disable (true) or enable (false) the service"),
      certificate: z.string().optional().describe("Certificate name (for TLS services)"),
    },
    async handler(a, ctx) {
      ctx.info(`Updating IP service: name=${a.name}`);
      const cmd = new Cmd(`/ip service set [find name="${a.name}"]`)
        .opt("port", a.port)
        .opt("address", a.address)
        .bool("disabled", a.disabled)
        .opt("certificate", a.certificate)
        .build();

      if (!cmd.includes("=", cmd.indexOf("]"))) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update IP service: ${result}`;

      const details = await executeMikrotikCommand(
        `/ip service print detail where name="${a.name}"`,
        ctx,
      );
      return `IP service updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "enable_ip_service",
    title: "Enable IP Service",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a management service.",
    inputSchema: {
      name: z.string().describe("Service name to enable, e.g. 'ssh'"),
    },
    async handler(a, ctx) {
      ctx.info(`Enabling IP service: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ip service enable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to enable IP service: ${result}`;
      return `IP service '${a.name}' enabled successfully.`;
    },
  }),

  defineTool({
    name: "disable_ip_service",
    title: "Disable IP Service",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a management service (useful for hardening: telnet, ftp, www).",
    inputSchema: {
      name: z.string().describe("Service name to disable, e.g. 'telnet'"),
    },
    async handler(a, ctx) {
      ctx.info(`Disabling IP service: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ip service disable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to disable IP service: ${result}`;
      return `IP service '${a.name}' disabled successfully.`;
    },
  }),
];
