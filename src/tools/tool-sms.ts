/** SMS over an LTE/modem channel — `/tool sms`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const smsTools: ToolModule = [
  defineTool({
    name: "get_sms_settings",
    title: "Get SMS Settings",
    annotations: READ,
    description: "Gets the SMS settings of the MikroTik device (`/tool sms`).",
    async handler(_a, ctx) {
      ctx.info("Getting sms settings");
      const result = await executeMikrotikCommand("/tool sms print", ctx);
      return isEmpty(result) ? "Unable to read sms settings." : `SMS SETTINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_sms_settings",
    title: "Update SMS Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates the SMS settings of the MikroTik device.\n\n" +
      "Notes:\n" +
      "    port: the LTE/modem interface used for SMS, e.g. 'lte1'.\n" +
      "    receive_enabled: store incoming SMS in the inbox.\n" +
      "    allowed_number: only act on remote commands from this number.",
    inputSchema: {
      port: z.string().optional().describe("LTE/modem port, e.g. 'lte1'"),
      receive_enabled: z.boolean().optional(),
      secret: z.string().optional().describe("Secret for remote SMS commands"),
      allowed_number: z.string().optional(),
      channel: z.number().int().optional(),
      sim_pin: z.string().optional(),
    },
    async handler(a, ctx) {
      // secret / sim_pin intentionally not logged.
      ctx.info("Updating sms settings");
      const cmd = new Cmd("/tool sms set")
        .opt("port", a.port)
        .bool("receive-enabled", a.receive_enabled)
        .opt("secret", a.secret)
        .opt("allowed-number", a.allowed_number)
        .opt("channel", a.channel)
        .opt("sim-pin", a.sim_pin);

      const built = cmd.build();
      if (built === "/tool sms set") return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result)) return `Failed to update sms settings: ${result}`;
      const details = await executeMikrotikCommand("/tool sms print", ctx);
      return `SMS settings updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "send_sms",
    title: "Send SMS",
    annotations: WRITE,
    description: "Sends an SMS message via the device's LTE/modem (`/tool sms send`).",
    inputSchema: {
      port: z.string().describe("LTE/modem port, e.g. 'lte1'"),
      phone_number: z.string().describe("Destination phone number"),
      message: z.string().describe("Message text"),
      smsc: z.string().optional().describe("SMS service center number"),
      channel: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Sending SMS via ${a.port} to ${a.phone_number}`);
      const cmd = new Cmd("/tool sms send")
        .set("port", a.port)
        .set("phone-number", a.phone_number)
        .set("message", a.message)
        .opt("smsc", a.smsc)
        .opt("channel", a.channel)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to send SMS: ${result}`;
      return `SMS sent to ${a.phone_number}.`;
    },
  }),

  defineTool({
    name: "list_sms_inbox",
    title: "List SMS Inbox",
    annotations: READ,
    description: "Lists received SMS messages (`/tool sms inbox`).",
    inputSchema: {
      phone_filter: z.string().optional().describe("Partial sender match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing sms inbox");
      const filters: string[] = [];
      if (a.phone_filter) filters.push(`phone~"${a.phone_filter}"`);

      const result = await executeMikrotikCommand(
        `/tool sms inbox print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No SMS messages found matching the criteria."
        : `SMS INBOX:\n\n${result}`;
    },
  }),
];
