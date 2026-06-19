/**
 * Queues — `/queue type`, `/queue tree`, `/queue simple`.
 *
 * Covers queue types (qdiscs), hierarchical queue trees, and simple per-target
 * rate-limit queues, each with the full create/list/get/update/remove lifecycle
 * (trees and simple queues additionally expose enable/disable).
 */
import { z } from "zod";
import type { ToolContext } from "../core/context";
import { executeMikrotikCommand } from "../core/connector";
import {
  WRITE_IDEMPOTENT,
  WRITE,
  READ,
  DESTRUCTIVE,
  defineTool,
} from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";

/**
 * Shared "create, then verify" flow: when RouterOS echoes a new `.id` (`*N` or a
 * bare number) re-print by id, otherwise fall back to a lookup by name — mirroring
 * the original Python control flow exactly.
 */
async function verifyCreate(
  result: string,
  path: string,
  name: string,
  label: string,
  ctx: ToolContext,
): Promise<string> {
  if (result.trim()) {
    if (result.includes("*") || /^\d+$/.test(result.trim())) {
      const id = result.trim();
      const details = await executeMikrotikCommand(
        `${path} print detail where .id=${id}`,
        ctx,
      );
      if (details.trim()) return `${label} created successfully:\n\n${details}`;
      return `${label} created with ID: ${id}`;
    }
    if (looksLikeError(result))
      return `Failed to create ${label.toLowerCase()}: ${result}`;
  }
  const details = await executeMikrotikCommand(
    `${path} print detail where name="${name}"`,
    ctx,
  );
  if (details.trim()) return `${label} created successfully:\n\n${details}`;
  return `${label} creation completed but unable to verify.`;
}

const QueueKind = z.enum([
  "cake",
  "fq-codel",
  "sfq",
  "red",
  "pcq",
  "pfifo",
  "bfifo",
  "pfifo-bpf",
  "mq-pfifo",
  "none",
]);
const CakeFlowmode = z.enum([
  "triple-isolate",
  "dual-srchost",
  "dual-dsthost",
  "host",
  "flow",
  "none",
]);
const CakeDiffserv = z.enum([
  "besteffort",
  "diffserv3",
  "diffserv4",
  "diffserv8",
]);
const CakeAckFilter = z.enum(["filter", "aggressive", "none"]);

export const queueTools: ToolModule = [
  // ── Queue Types ───────────────────────────────────────────────
  defineTool({
    name: "create_queue_type",
    title: "Create Queue Type",
    annotations: WRITE,
    description:
      "Creates a queue type (qdisc). kind selects the discipline (cake, fq-codel, sfq, red, pcq, pfifo, bfifo); remaining params are per-discipline options.",
    inputSchema: {
      name: z.string(),
      kind: QueueKind.default("cake"),
      cake_flowmode: CakeFlowmode.optional(),
      cake_nat: z.boolean().optional(),
      cake_overhead: z.number().int().optional(),
      cake_mpu: z.number().int().optional(),
      cake_diffserv: CakeDiffserv.optional(),
      cake_ack_filter: CakeAckFilter.optional(),
      cake_rtt: z
        .string()
        .optional()
        .describe('Round-trip time e.g. "50ms", "100ms"'),
      cake_wash: z.boolean().optional(),
      cake_overhead_scheme: z.string().optional(),
      pcq_rate: z
        .string()
        .optional()
        .describe('Bandwidth per flow e.g. "1M", "512k"'),
      pcq_limit: z.number().int().optional(),
      pcq_classifier: z
        .string()
        .optional()
        .describe('Comma-separated classifiers e.g. "src-address,dst-address"'),
      pfifo_limit: z.number().int().optional(),
      bfifo_limit: z.number().int().optional(),
      sfq_perturb: z.number().int().optional(),
      sfq_allot: z.number().int().optional(),
      fq_codel_limit: z.number().int().optional(),
      fq_codel_quantum: z.number().int().optional(),
      fq_codel_target: z
        .string()
        .optional()
        .describe('Time e.g. "5ms", "100ms"'),
      fq_codel_interval: z
        .string()
        .optional()
        .describe('Time e.g. "5ms", "100ms"'),
      red_limit: z.number().int().optional(),
      red_min_threshold: z.number().int().optional(),
      red_max_threshold: z.number().int().optional(),
      red_burst: z.number().int().optional(),
      red_avg_packet: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Creating queue type: name=${a.name}, kind=${a.kind}`);
      const cmd = new Cmd("/queue type add")
        .set("name", a.name)
        .set("kind", a.kind)
        // CAKE parameters
        .opt("cake-flowmode", a.cake_flowmode)
        .bool("cake-nat", a.cake_nat)
        .opt("cake-overhead", a.cake_overhead)
        .opt("cake-mpu", a.cake_mpu)
        .opt("cake-diffserv", a.cake_diffserv)
        .opt("cake-ack-filter", a.cake_ack_filter)
        .opt("cake-rtt", a.cake_rtt)
        .bool("cake-wash", a.cake_wash)
        .opt("cake-overhead-scheme", a.cake_overhead_scheme)
        // PCQ parameters
        .opt("pcq-rate", a.pcq_rate)
        .opt("pcq-limit", a.pcq_limit)
        .opt("pcq-classifier", a.pcq_classifier)
        // PFIFO/BFIFO parameters
        .opt("pfifo-limit", a.pfifo_limit)
        .opt("bfifo-limit", a.bfifo_limit)
        // SFQ parameters
        .opt("sfq-perturb", a.sfq_perturb)
        .opt("sfq-allot", a.sfq_allot)
        // FQ-CoDel parameters
        .opt("fq-codel-limit", a.fq_codel_limit)
        .opt("fq-codel-quantum", a.fq_codel_quantum)
        .opt("fq-codel-target", a.fq_codel_target)
        .opt("fq-codel-interval", a.fq_codel_interval)
        // RED parameters
        .opt("red-limit", a.red_limit)
        .opt("red-min-threshold", a.red_min_threshold)
        .opt("red-max-threshold", a.red_max_threshold)
        .opt("red-burst", a.red_burst)
        .opt("red-avg-packet", a.red_avg_packet)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      return verifyCreate(result, "/queue type", a.name, "Queue type", ctx);
    },
  }),

  defineTool({
    name: "list_queue_types",
    title: "List Queue Types",
    annotations: READ,
    description: "Lists queue types on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      kind_filter: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Listing queue types");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.kind_filter) filters.push(`kind=${a.kind_filter}`);

      let cmd = "/queue type print";
      if (filters.length) cmd += ` where ${filters.join(" ")}`;

      const result = await executeMikrotikCommand(cmd, ctx);
      return isEmpty(result)
        ? "No queue types found matching the criteria."
        : `QUEUE TYPES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_queue_type",
    title: "Get Queue Type",
    annotations: READ,
    description: "Gets detailed information about a specific queue type.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting queue type details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/queue type print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `Queue type '${a.name}' not found.`
        : `QUEUE TYPE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_queue_type",
    title: "Update Queue Type",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates an existing queue type's discipline-specific settings.",
    inputSchema: {
      name: z.string(),
      new_name: z.string().optional(),
      cake_flowmode: z.string().optional(),
      cake_nat: z.boolean().optional(),
      cake_overhead: z.number().int().optional(),
      cake_mpu: z.number().int().optional(),
      cake_diffserv: z.string().optional(),
      cake_ack_filter: z.string().optional(),
      cake_rtt: z.string().optional(),
      cake_wash: z.boolean().optional(),
      cake_overhead_scheme: z.string().optional(),
      pcq_rate: z.string().optional(),
      pcq_limit: z.number().int().optional(),
      pcq_classifier: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating queue type: name=${a.name}`);
      const cmd = new Cmd(`/queue type set [find name="${a.name}"]`)
        .opt("name", a.new_name)
        .opt("cake-flowmode", a.cake_flowmode)
        .bool("cake-nat", a.cake_nat)
        .opt("cake-overhead", a.cake_overhead)
        .opt("cake-mpu", a.cake_mpu)
        .opt("cake-diffserv", a.cake_diffserv)
        .opt("cake-ack-filter", a.cake_ack_filter)
        .opt("cake-rtt", a.cake_rtt)
        .bool("cake-wash", a.cake_wash)
        .opt("cake-overhead-scheme", a.cake_overhead_scheme)
        .opt("pcq-rate", a.pcq_rate)
        .opt("pcq-limit", a.pcq_limit)
        .opt("pcq-classifier", a.pcq_classifier)
        .build();

      if (!cmd.includes("=", cmd.indexOf("]"))) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to update queue type: ${result}`;

      const lookupName = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(
        `/queue type print detail where name="${lookupName}"`,
        ctx,
      );
      return `Queue type updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_queue_type",
    title: "Remove Queue Type",
    annotations: DESTRUCTIVE,
    description: "Removes a queue type from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing queue type: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/queue type remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove queue type: ${result}`;
      return `Queue type '${a.name}' removed successfully.`;
    },
  }),

  // ── Queue Trees ───────────────────────────────────────────────
  defineTool({
    name: "create_queue_tree",
    title: "Create Queue Tree",
    annotations: WRITE,
    description:
      "Creates a hierarchical queue tree entry attached to a parent interface or queue.",
    inputSchema: {
      name: z.string(),
      parent: z
        .string()
        .describe('Interface name e.g. "ether1" or parent queue name'),
      queue: z.string().optional(),
      packet_mark: z.string().optional(),
      max_limit: z
        .string()
        .optional()
        .describe('Bandwidth e.g. "10M", "512k", "1G"'),
      limit_at: z
        .string()
        .optional()
        .describe('Bandwidth e.g. "10M", "512k", "1G"'),
      burst_limit: z
        .string()
        .optional()
        .describe('Bandwidth e.g. "10M", "512k", "1G"'),
      burst_threshold: z
        .string()
        .optional()
        .describe('Bandwidth e.g. "10M", "512k", "1G"'),
      burst_time: z.string().optional().describe('Duration e.g. "8s"'),
      bucket_size: z.string().optional(),
      priority: z
        .number()
        .int()
        .optional()
        .describe("1 (highest) – 8 (lowest)"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Creating queue tree: name=${a.name}, parent=${a.parent}`);
      const cmd = new Cmd("/queue tree add")
        .set("name", a.name)
        .set("parent", a.parent)
        .opt("queue", a.queue)
        .opt("packet-mark", a.packet_mark)
        .opt("max-limit", a.max_limit)
        .opt("limit-at", a.limit_at)
        .opt("burst-limit", a.burst_limit)
        .opt("burst-threshold", a.burst_threshold)
        .opt("burst-time", a.burst_time)
        .opt("bucket-size", a.bucket_size)
        .opt("priority", a.priority)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      return verifyCreate(result, "/queue tree", a.name, "Queue tree", ctx);
    },
  }),

  defineTool({
    name: "list_queue_trees",
    title: "List Queue Trees",
    annotations: READ,
    description: "Lists queue trees on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      parent_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      invalid_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing queue trees");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.parent_filter) filters.push(`parent="${a.parent_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.invalid_only) filters.push("invalid=yes");

      let cmd = "/queue tree print";
      if (filters.length) cmd += ` where ${filters.join(" ")}`;

      const result = await executeMikrotikCommand(cmd, ctx);
      return isEmpty(result)
        ? "No queue trees found matching the criteria."
        : `QUEUE TREES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_queue_tree",
    title: "Get Queue Tree",
    annotations: READ,
    description: "Gets detailed information about a specific queue tree.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting queue tree details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/queue tree print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `Queue tree '${a.name}' not found.`
        : `QUEUE TREE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_queue_tree",
    title: "Update Queue Tree",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates an existing queue tree entry (bandwidth limits, parent, priority, etc.).",
    inputSchema: {
      name: z.string(),
      new_name: z.string().optional(),
      parent: z.string().optional(),
      queue: z.string().optional(),
      packet_mark: z.string().optional(),
      max_limit: z.string().optional().describe('Bandwidth e.g. "10M", "512k"'),
      limit_at: z.string().optional().describe('Bandwidth e.g. "10M", "512k"'),
      burst_limit: z
        .string()
        .optional()
        .describe('Bandwidth e.g. "10M", "512k"'),
      burst_threshold: z
        .string()
        .optional()
        .describe('Bandwidth e.g. "10M", "512k"'),
      burst_time: z.string().optional().describe('Duration e.g. "8s"'),
      bucket_size: z.string().optional(),
      priority: z
        .number()
        .int()
        .optional()
        .describe("1 (highest) – 8 (lowest)"),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating queue tree: name=${a.name}`);
      const cmd = new Cmd(`/queue tree set [find name="${a.name}"]`)
        .opt("name", a.new_name)
        .opt("parent", a.parent)
        .opt("queue", a.queue)
        .opt("packet-mark", a.packet_mark)
        .opt("max-limit", a.max_limit)
        .opt("limit-at", a.limit_at)
        .opt("burst-limit", a.burst_limit)
        .opt("burst-threshold", a.burst_threshold)
        .opt("burst-time", a.burst_time)
        .opt("bucket-size", a.bucket_size)
        .opt("priority", a.priority)
        .opt("comment", a.comment)
        .bool("disabled", a.disabled)
        .build();

      if (!cmd.includes("=", cmd.indexOf("]"))) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to update queue tree: ${result}`;

      const lookupName = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(
        `/queue tree print detail where name="${lookupName}"`,
        ctx,
      );
      return `Queue tree updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_queue_tree",
    title: "Remove Queue Tree",
    annotations: DESTRUCTIVE,
    description: "Removes a queue tree from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing queue tree: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/queue tree remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove queue tree: ${result}`;
      return `Queue tree '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_queue_tree",
    title: "Enable Queue Tree",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a queue tree.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Enabling queue tree: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/queue tree set [find name="${a.name}"] disabled=no`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to enable queue tree: ${result}`;

      const details = await executeMikrotikCommand(
        `/queue tree print detail where name="${a.name}"`,
        ctx,
      );
      return `Queue tree enabled:\n\n${details}`;
    },
  }),

  defineTool({
    name: "disable_queue_tree",
    title: "Disable Queue Tree",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a queue tree.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Disabling queue tree: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/queue tree set [find name="${a.name}"] disabled=yes`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to disable queue tree: ${result}`;

      const details = await executeMikrotikCommand(
        `/queue tree print detail where name="${a.name}"`,
        ctx,
      );
      return `Queue tree disabled:\n\n${details}`;
    },
  }),

  // ── Simple Queues ─────────────────────────────────────────────
  defineTool({
    name: "create_simple_queue",
    title: "Create Simple Queue",
    annotations: WRITE,
    description:
      "Creates a simple queue to rate-limit a target address or interface.",
    inputSchema: {
      name: z.string(),
      target: z
        .string()
        .describe('IP/CIDR or interface e.g. "192.168.1.0/24" or "ether1"'),
      dst: z.string().optional(),
      max_limit: z
        .string()
        .optional()
        .describe(
          'Upload/download bandwidth as "UL/DL" e.g. "10M/10M", or single value e.g. "10M"',
        ),
      limit_at: z
        .string()
        .optional()
        .describe(
          'Upload/download bandwidth as "UL/DL" e.g. "10M/10M", or single value e.g. "10M"',
        ),
      burst_limit: z
        .string()
        .optional()
        .describe(
          'Upload/download bandwidth as "UL/DL" e.g. "10M/10M", or single value e.g. "10M"',
        ),
      burst_threshold: z
        .string()
        .optional()
        .describe(
          'Upload/download bandwidth as "UL/DL" e.g. "10M/10M", or single value e.g. "10M"',
        ),
      burst_time: z.string().optional().describe('Duration e.g. "8s"'),
      bucket_size: z.string().optional(),
      queue: z.string().optional(),
      parent: z.string().optional(),
      priority: z.string().optional().describe("1 (highest) – 8 (lowest)"),
      packet_marks: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Creating simple queue: name=${a.name}, target=${a.target}`);
      const cmd = new Cmd("/queue simple add")
        .set("name", a.name)
        .set("target", a.target)
        .opt("dst", a.dst)
        .opt("max-limit", a.max_limit)
        .opt("limit-at", a.limit_at)
        .opt("burst-limit", a.burst_limit)
        .opt("burst-threshold", a.burst_threshold)
        .opt("burst-time", a.burst_time)
        .opt("bucket-size", a.bucket_size)
        .opt("queue", a.queue)
        .opt("parent", a.parent)
        .opt("priority", a.priority)
        .opt("packet-marks", a.packet_marks)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      return verifyCreate(result, "/queue simple", a.name, "Simple queue", ctx);
    },
  }),

  defineTool({
    name: "list_simple_queues",
    title: "List Simple Queues",
    annotations: READ,
    description: "Lists simple queues on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      target_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      invalid_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing simple queues");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.target_filter) filters.push(`target~"${a.target_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.invalid_only) filters.push("invalid=yes");

      let cmd = "/queue simple print";
      if (filters.length) cmd += ` where ${filters.join(" ")}`;

      const result = await executeMikrotikCommand(cmd, ctx);
      return isEmpty(result)
        ? "No simple queues found matching the criteria."
        : `SIMPLE QUEUES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_simple_queue",
    title: "Get Simple Queue",
    annotations: READ,
    description: "Gets detailed information about a specific simple queue.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting simple queue details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/queue simple print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `Simple queue '${a.name}' not found.`
        : `SIMPLE QUEUE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_simple_queue",
    title: "Update Simple Queue",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates an existing simple queue's rate limits, target, or scheduling settings.",
    inputSchema: {
      name: z.string(),
      new_name: z.string().optional(),
      target: z
        .string()
        .optional()
        .describe('IP/CIDR or interface e.g. "192.168.1.0/24" or "ether1"'),
      dst: z.string().optional(),
      max_limit: z
        .string()
        .optional()
        .describe(
          'Upload/download bandwidth as "UL/DL" e.g. "10M/10M", or single value e.g. "10M"',
        ),
      limit_at: z
        .string()
        .optional()
        .describe(
          'Upload/download bandwidth as "UL/DL" e.g. "10M/10M", or single value e.g. "10M"',
        ),
      burst_limit: z
        .string()
        .optional()
        .describe(
          'Upload/download bandwidth as "UL/DL" e.g. "10M/10M", or single value e.g. "10M"',
        ),
      burst_threshold: z
        .string()
        .optional()
        .describe(
          'Upload/download bandwidth as "UL/DL" e.g. "10M/10M", or single value e.g. "10M"',
        ),
      burst_time: z.string().optional().describe('Duration e.g. "8s"'),
      bucket_size: z.string().optional(),
      queue: z.string().optional(),
      parent: z.string().optional(),
      priority: z.string().optional().describe("1 (highest) – 8 (lowest)"),
      packet_marks: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating simple queue: name=${a.name}`);
      const cmd = new Cmd(`/queue simple set [find name="${a.name}"]`)
        .opt("name", a.new_name)
        .opt("target", a.target)
        .opt("dst", a.dst)
        .opt("max-limit", a.max_limit)
        .opt("limit-at", a.limit_at)
        .opt("burst-limit", a.burst_limit)
        .opt("burst-threshold", a.burst_threshold)
        .opt("burst-time", a.burst_time)
        .opt("bucket-size", a.bucket_size)
        .opt("queue", a.queue)
        .opt("parent", a.parent)
        .opt("priority", a.priority)
        .opt("packet-marks", a.packet_marks)
        .opt("comment", a.comment)
        .bool("disabled", a.disabled)
        .build();

      if (!cmd.includes("=", cmd.indexOf("]"))) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to update simple queue: ${result}`;

      const lookupName = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(
        `/queue simple print detail where name="${lookupName}"`,
        ctx,
      );
      return `Simple queue updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_simple_queue",
    title: "Remove Simple Queue",
    annotations: DESTRUCTIVE,
    description: "Removes a simple queue from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing simple queue: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/queue simple remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove simple queue: ${result}`;
      return `Simple queue '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_simple_queue",
    title: "Enable Simple Queue",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a simple queue.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Enabling simple queue: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/queue simple set [find name="${a.name}"] disabled=no`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to enable simple queue: ${result}`;

      const details = await executeMikrotikCommand(
        `/queue simple print detail where name="${a.name}"`,
        ctx,
      );
      return `Simple queue enabled:\n\n${details}`;
    },
  }),

  defineTool({
    name: "disable_simple_queue",
    title: "Disable Simple Queue",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a simple queue.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Disabling simple queue: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/queue simple set [find name="${a.name}"] disabled=yes`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to disable simple queue: ${result}`;

      const details = await executeMikrotikCommand(
        `/queue simple print detail where name="${a.name}"`,
        ctx,
      );
      return `Simple queue disabled:\n\n${details}`;
    },
  }),
];
