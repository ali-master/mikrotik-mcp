/**
 * Port-Knock Guardian — hide management services (SSH/Winbox/API) behind a
 * secret port-knock sequence. Generates the staged firewall address-list ladder
 * (knock-1 → knock-2 → … → allowed) plus the accept-if-knocked / drop-otherwise
 * rules, so the admin ports are invisible to scanners and open only after the
 * correct knock — instead of hand-crafting a brittle chain by hand.
 *
 * The pure `buildKnockRules` is unit-tested; the tool wires apply/preview.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { DANGEROUS, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { Cmd, looksLikeError } from "../core/routeros";

export const KNOCK_TAG = "port-knock";

export interface KnockOptions {
  /** The secret knock sequence (ports hit in order). */
  sequence: number[];
  /** Management ports to hide until knocked (e.g. "22,8291,8728"). */
  protectPorts: string;
  /** How long access stays open after the final knock. */
  openTimeout: string;
  /** Window allowed between consecutive knocks. */
  stageTimeout: string;
}

/** Build the port-knock firewall rules (chain=input), in evaluation order. */
export function buildKnockRules(o: KnockOptions): string[] {
  const lists = o.sequence.map((_, i) => `${KNOCK_TAG}-${i + 1}`);
  const allowed = `${KNOCK_TAG}-allowed`;
  const rule = (parts: [string, string | number][], label: string): string => {
    const c = new Cmd("/ip firewall filter add");
    for (const [k, v] of parts) c.set(k, v);
    c.set("comment", `${KNOCK_TAG}: ${label}`);
    return c.build();
  };

  const out: string[] = [];
  // Knock ladder: each port advances the source one stage; the last → allowed.
  o.sequence.forEach((port, i) => {
    const last = i === o.sequence.length - 1;
    const parts: [string, string | number][] = [
      ["chain", "input"],
      ["protocol", "tcp"],
      ["dst-port", port],
      ["action", "add-src-to-address-list"],
      ["address-list", last ? allowed : lists[i]],
      ["address-list-timeout", last ? o.openTimeout : o.stageTimeout],
    ];
    // From the 2nd knock on, require the source to already be at the prior stage.
    if (i > 0) parts.splice(3, 0, ["src-address-list", lists[i - 1]]);
    out.push(rule(parts, `knock ${i + 1}/${o.sequence.length} (port ${port})`));
  });
  // Accept management only from a source that completed the full knock.
  out.push(
    rule(
      [
        ["chain", "input"],
        ["protocol", "tcp"],
        ["dst-port", o.protectPorts],
        ["src-address-list", allowed],
        ["action", "accept"],
      ],
      "allow management when knocked",
    ),
  );
  // Hide management from everyone else.
  out.push(
    rule(
      [
        ["chain", "input"],
        ["protocol", "tcp"],
        ["dst-port", o.protectPorts],
        ["action", "drop"],
      ],
      "hide management",
    ),
  );
  return out;
}

export const portKnockTools: ToolModule = [
  defineTool({
    name: "setup_port_knock",
    title: "Set Up Port-Knock Guardian",
    annotations: DANGEROUS,
    description:
      "Hides management services behind a secret port-knock `sequence`: a source must connect to the " +
      "knock ports in order to be added to an allow-list, after which the `protect_ports` (SSH/Winbox/" +
      "API, default 22,8291,8728) accept it — everyone else is dropped, so the ports are invisible to " +
      "scanners. Generates the staged address-list ladder + accept/drop rules. DEFAULTS TO A DRY RUN " +
      "(`apply=false`); set `apply=true` to install. WARNING: after applying, management is only " +
      "reachable by knocking the exact sequence — make sure you can knock (and keep a console/trusted " +
      "path). Rules are tagged 'port-knock:'. Returns the plan or a build report.",
    inputSchema: {
      sequence: z
        .array(z.number().int().min(1).max(65535))
        .min(2)
        .describe("Secret knock ports, in order, e.g. [7001, 8002, 9003]"),
      protect_ports: z.string().default("22,8291,8728").describe("Management ports to hide"),
      open_timeout: z.string().default("1h").describe("How long access stays open after the knock"),
      stage_timeout: z
        .string()
        .default("10s")
        .describe("Allowed window between consecutive knocks"),
      apply: z.boolean().default(false).describe("false = preview (default); true = install"),
    },
    async handler(a, ctx) {
      const commands = buildKnockRules({
        sequence: a.sequence as number[],
        protectPorts: a.protect_ports,
        openTimeout: a.open_timeout,
        stageTimeout: a.stage_timeout,
      });
      if (!a.apply) {
        const plan = commands.map((c, i) => `${i + 1}. ${c}`).join("\n");
        return `DRY RUN — port-knock sequence ${(a.sequence as number[]).join(" → ")} hiding ${a.protect_ports}; ${commands.length} rule(s) (set apply=true to install):\n\n${plan}`;
      }
      const done: string[] = [];
      for (const cmd of commands) {
        const result = await executeMikrotikCommand(cmd, ctx);
        if (looksLikeError(result)) {
          return `Installed ${done.length}/${commands.length} rules, then FAILED: ${result}\nManagement access may be partially restricted — review immediately.`;
        }
        done.push(cmd);
      }
      return `Port-knock installed — ${done.length} rule(s). Management (${a.protect_ports}) is now hidden until the sequence ${(a.sequence as number[]).join(" → ")} is knocked.`;
    },
  }),
];
