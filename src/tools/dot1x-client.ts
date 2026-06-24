/** 802.1X supplicant — `/interface dot1x client`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { yesno, whereClause, quoteValue, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const dot1xClientTools: ToolModule = [
  defineTool({
    name: "add_dot1x_client",
    title: "Add Dot1x Client",
    annotations: WRITE,
    description:
      "Adds an 802.1X supplicant (client) on an interface so the device can " +
      "authenticate itself to an upstream authenticator " +
      "(`/interface dot1x client`).\n\n" +
      "Notes:\n" +
      "    eap_methods: comma-separated, e.g. 'eap-tls', 'eap-peap',\n" +
      "        'eap-mschapv2', 'eap-ttls'.\n" +
      "    certificate: required for eap-tls; identity/password for the\n" +
      "        password-based methods.",
    inputSchema: {
      interface: z.string(),
      eap_methods: z
        .string()
        .describe("Comma-separated EAP methods, e.g. 'eap-tls' or 'eap-peap,eap-mschapv2'"),
      identity: z.string().optional().describe("EAP identity (username)"),
      anonymous_identity: z.string().optional(),
      certificate: z.string().optional().describe("Client certificate name (required for eap-tls)"),
      password: z.string().optional().describe("EAP password (password methods)"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      // Note: password is intentionally not logged.
      ctx.info(`Adding dot1x client: interface=${a.interface}`);
      const cmd = new Cmd("/interface dot1x client add")
        .set("interface", a.interface)
        .set("eap-methods", a.eap_methods)
        .opt("identity", a.identity)
        .opt("anonymous-identity", a.anonymous_identity)
        .opt("certificate", a.certificate)
        .opt("password", a.password)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add dot1x client: ${result}`;
      const details = await executeMikrotikCommand(
        `/interface dot1x client print detail where interface="${a.interface}"`,
        ctx,
      );
      return details.trim()
        ? `Dot1x client added successfully:\n\n${details}`
        : "Dot1x client addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_dot1x_clients",
    title: "List Dot1x Clients",
    annotations: READ,
    description: "Lists 802.1X supplicants on the MikroTik device.",
    inputSchema: {
      interface_filter: z.string().optional(),
      status_filter: z
        .string()
        .optional()
        .describe("Match status, e.g. 'authenticated', 'authenticating'"),
      disabled_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing dot1x clients");
      const filters: string[] = [];
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);
      if (a.status_filter) filters.push(`status~"${a.status_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");

      const result = await executeMikrotikCommand(
        `/interface dot1x client print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No dot1x clients found matching the criteria."
        : `DOT1X CLIENTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_dot1x_client",
    title: "Get Dot1x Client",
    annotations: READ,
    description: "Gets a specific 802.1X supplicant by interface or '.id'.",
    inputSchema: {
      client_id: z.string().describe("Interface name (e.g. 'ether3') or RouterOS '.id'"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting dot1x client: client_id=${a.client_id}`);
      let result = await executeMikrotikCommand(
        `/interface dot1x client print detail where .id="${a.client_id}"`,
        ctx,
      );
      if (isEmpty(result)) {
        result = await executeMikrotikCommand(
          `/interface dot1x client print detail where interface="${a.client_id}"`,
          ctx,
        );
      }
      return isEmpty(result)
        ? `Dot1x client '${a.client_id}' not found.`
        : `DOT1X CLIENT DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_dot1x_client",
    title: "Update Dot1x Client",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates an 802.1X supplicant (by interface or '.id'). " +
      'Pass comment="" to clear the comment.',
    inputSchema: {
      client_id: z.string().describe("Interface name or RouterOS '.id'"),
      eap_methods: z.string().optional(),
      identity: z.string().optional(),
      anonymous_identity: z.string().optional(),
      certificate: z.string().optional(),
      password: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating dot1x client: client_id=${a.client_id}`);
      const selector = a.client_id.startsWith("*")
        ? `.id="${a.client_id}"`
        : `interface="${a.client_id}"`;
      const base = `/interface dot1x client set [find ${selector}]`;
      const cmd = new Cmd(base)
        .opt("eap-methods", a.eap_methods)
        .opt("identity", a.identity)
        .opt("anonymous-identity", a.anonymous_identity)
        .opt("certificate", a.certificate)
        .opt("password", a.password);
      if (a.comment !== undefined) cmd.raw(`comment=${quoteValue(a.comment)}`);
      if (a.disabled !== undefined) cmd.raw(`disabled=${yesno(a.disabled)}`);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result)) return `Failed to update dot1x client: ${result}`;
      const details = await executeMikrotikCommand(
        `/interface dot1x client print detail where ${selector}`,
        ctx,
      );
      return `Dot1x client updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_dot1x_client",
    title: "Remove Dot1x Client",
    annotations: DESTRUCTIVE,
    description: "Removes an 802.1X supplicant by interface or '.id' from the MikroTik device.",
    inputSchema: {
      client_id: z.string().describe("Interface name or RouterOS '.id'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing dot1x client: client_id=${a.client_id}`);
      const selector = a.client_id.startsWith("*")
        ? `.id="${a.client_id}"`
        : `interface="${a.client_id}"`;
      const count = await executeMikrotikCommand(
        `/interface dot1x client print count-only where ${selector}`,
        ctx,
      );
      if (count.trim() === "0") return `Dot1x client '${a.client_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface dot1x client remove [find ${selector}]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove dot1x client: ${result}`;
      return `Dot1x client '${a.client_id}' removed successfully.`;
    },
  }),
];
