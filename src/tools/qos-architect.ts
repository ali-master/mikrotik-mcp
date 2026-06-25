/**
 * QoS Architect — turns a high-level traffic-shaping intent into RouterOS
 * `/queue simple` classes in one call, with a preview-before-apply step.
 *
 * The natural-language part ("prioritize VoIP, cap guests to 10M") is the model's
 * job; this tool takes the resulting structured classes and builds the queues
 * atomically — defaulting to a DRY RUN that shows exactly what would be created,
 * so a shaping policy can be reviewed before it touches the device. For
 * port/protocol-based classification (rather than by address) pair this with the
 * mangle + queue-tree tools.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, Cmd } from "../core/routeros";

const QosClass = z.object({
  name: z.string().describe("Queue name, e.g. 'voip' or 'guest-cap'"),
  target: z
    .string()
    .describe("Target address/subnet this class applies to, e.g. '192.168.20.0/24'"),
  max_limit: z
    .string()
    .describe("RouterOS max-limit as 'upload/download', e.g. '10M/10M' (or a single value)"),
  priority: z
    .number()
    .int()
    .min(1)
    .max(8)
    .default(8)
    .describe("1 (highest) … 8 (lowest); lower number wins under contention"),
  comment: z.string().optional(),
});

export const qosArchitectTools: ToolModule = [
  defineTool({
    name: "apply_traffic_shaping",
    title: "Apply Traffic-Shaping Policy",
    annotations: WRITE,
    description:
      "Builds a traffic-shaping policy as a batch of `/queue simple` classes (target address, " +
      "max-limit, priority) in one call — e.g. prioritize a VoIP subnet and cap a guest network. " +
      "DEFAULTS TO A DRY RUN: with `apply=false` (default) it returns the exact RouterOS commands it " +
      "WOULD run so the shape can be reviewed first; set `apply=true` to create the queues and " +
      "verify them. Classes are created in array order, and RouterOS evaluates simple queues " +
      "top-down, so list the most specific/important first. For classification by port/protocol " +
      "(not address) use the firewall mangle tools to mark packets, then a queue tree. Returns the " +
      "dry-run plan or the created queues.",
    inputSchema: {
      classes: z.array(QosClass).min(1).describe("Shaping classes to create, in priority order"),
      apply: z
        .boolean()
        .default(false)
        .describe("false = preview the commands only (default); true = create the queues"),
    },
    async handler(a, ctx) {
      const classes = a.classes as z.infer<typeof QosClass>[];
      ctx.info(`QoS: ${a.apply ? "applying" : "previewing"} ${classes.length} shaping class(es)`);
      const commands = classes.map((c) =>
        new Cmd("/queue simple add")
          .set("name", c.name)
          .set("target", c.target)
          .set("max-limit", c.max_limit)
          .opt("priority", `${c.priority}/${c.priority}`)
          .opt("comment", c.comment)
          .build(),
      );

      if (!a.apply) {
        const plan = commands.map((c: string, i: number) => `${i + 1}. ${c}`).join("\n");
        return `DRY RUN — ${commands.length} queue(s) would be created (set apply=true to execute):\n\n${plan}`;
      }

      const created: string[] = [];
      for (const [i, cmd] of commands.entries()) {
        const result = await executeMikrotikCommand(cmd, ctx);
        if (looksLikeError(result)) {
          const done = created.join(", ") || "none";
          return `Applied ${created.length}/${commands.length} classes, then FAILED on '${classes[i].name}': ${result}\nAlready-created: ${done}. Review and remove partial queues if needed (list_simple_queues / remove_simple_queue).`;
        }
        created.push(classes[i].name);
      }
      const verify = await executeMikrotikCommand("/queue simple print", ctx);
      return `Traffic-shaping policy applied — created ${created.length} queue(s): ${created.join(", ")}.\n\nQUEUES:\n\n${verify}`;
    },
  }),
];
