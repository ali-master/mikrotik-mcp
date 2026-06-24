/**
 * Per-interface queues — `/queue interface`.
 *
 * Each interface has one entry mapping it to a queue type (the queue applied to
 * traffic egressing that interface). Entries are fixed (one per interface), so
 * this scope is list/get plus assigning the queue type.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const queueInterfaceTools: ToolModule = [
  defineTool({
    name: "list_queue_interfaces",
    title: "List Queue Interfaces",
    annotations: READ,
    description:
      "Lists per-interface queue assignments on the MikroTik device (`/queue interface`).",
    inputSchema: {
      interface_filter: z.string().optional().describe("Partial interface-name match"),
      queue_filter: z.string().optional().describe("Partial queue-type-name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing queue interfaces");
      const filters: string[] = [];
      if (a.interface_filter) filters.push(`interface~"${a.interface_filter}"`);
      if (a.queue_filter) filters.push(`queue~"${a.queue_filter}"`);

      const result = await executeMikrotikCommand(
        `/queue interface print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No queue interfaces found matching the criteria."
        : `QUEUE INTERFACES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_queue_interface",
    title: "Get Queue Interface",
    annotations: READ,
    description: "Gets the queue assignment for a specific interface by name or '.id'.",
    inputSchema: {
      interface_id: z.string().describe("Interface name (e.g. 'ether1') or RouterOS '.id'"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting queue interface: interface_id=${a.interface_id}`);
      let result = await executeMikrotikCommand(
        `/queue interface print detail where .id="${a.interface_id}"`,
        ctx,
      );
      if (isEmpty(result)) {
        result = await executeMikrotikCommand(
          `/queue interface print detail where interface="${a.interface_id}"`,
          ctx,
        );
      }
      return isEmpty(result)
        ? `Queue interface '${a.interface_id}' not found.`
        : `QUEUE INTERFACE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_queue_interface",
    title: "Update Queue Interface",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Assigns a queue type to an interface on the MikroTik device.\n\n" +
      "Notes:\n" +
      "    queue: the queue-type name to apply, e.g. 'ethernet-default',\n" +
      "        'only-hardware-queue', or a custom queue type.",
    inputSchema: {
      interface_id: z.string().describe("Interface name (e.g. 'ether1') or RouterOS '.id'"),
      queue: z.string().describe("Queue-type name to apply to the interface"),
    },
    async handler(a, ctx) {
      ctx.info(`Updating queue interface: interface_id=${a.interface_id}`);
      const selector = a.interface_id.startsWith("*")
        ? `.id="${a.interface_id}"`
        : `interface="${a.interface_id}"`;
      const cmd = new Cmd(`/queue interface set [find ${selector}]`).set("queue", a.queue).build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update queue interface: ${result}`;

      const details = await executeMikrotikCommand(
        `/queue interface print detail where ${selector}`,
        ctx,
      );
      return `Queue interface updated successfully:\n\n${details}`;
    },
  }),
];
