/**
 * Prompt loader. MCP *prompts* are reusable, parameterized workflows the user
 * can invoke by name (e.g. "harden this router"). We author them as markdown
 * files in `prompts/` with a small YAML-ish frontmatter block, so prompt
 * content is editable data rather than compiled code.
 *
 * Frontmatter shape:
 *   ---
 *   name: harden-router
 *   title: Harden a RouterOS device
 *   description: One-line summary shown in the prompt picker.
 *   arguments:
 *     - name: wan_interface
 *       description: The WAN-facing interface.
 *       required: true
 *   ---
 *   Body text. Reference arguments with {{wan_interface}}.
 *
 * Implementation note: pattern matching below uses `String.prototype.match`
 * (not `RegExp.exec`) deliberately — no OS shell or `child_process` is involved.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logger } from "../logger";
import { PROMPTS_DIR } from "../paths";

interface PromptArg {
  name: string;
  description?: string;
  required?: boolean;
}
interface ParsedPrompt {
  name: string;
  title: string;
  description: string;
  arguments: PromptArg[];
  body: string;
}

/** Minimal frontmatter parser — handles the small subset of YAML we author. */
function parseFrontmatter(raw: string): ParsedPrompt | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const [, fm, body] = match;

  const meta: Record<string, string> = {};
  const args: PromptArg[] = [];
  let cur: PromptArg | null = null;
  let inArgs = false;

  for (const line of fm.split("\n")) {
    if (/^arguments:\s*$/.test(line)) {
      inArgs = true;
      continue;
    }
    if (inArgs) {
      const item = line.match(/^[ \t]*-[ \t]*name:[ \t]*(\S.*)$/);
      if (item) {
        if (cur) args.push(cur);
        cur = { name: item[1].trim() };
        continue;
      }
      const prop = line.match(/^[ \t]+(description|required):[ \t]*(\S.*)$/);
      if (prop && cur) {
        if (prop[1] === "required") cur.required = /^(true|yes)$/i.test(prop[2].trim());
        else cur.description = prop[2].trim().replace(/^["']|["']$/g, "");
        continue;
      }
      if (/^\S/.test(line)) inArgs = false; // a non-indented key ends the list
    }
    const kv = line.match(/^(\w+):[ \t]*(\S.*)?$/);
    if (kv && !inArgs) meta[kv[1]] = (kv[2] ?? "").trim().replace(/^["']|["']$/g, "");
  }
  if (cur) args.push(cur);

  if (!meta.name) return null;
  return {
    name: meta.name,
    title: meta.title ?? meta.name,
    description: meta.description ?? "",
    arguments: args,
    body: body.trim(),
  };
}

function substitute(body: string, vars: Record<string, unknown>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key) => {
    const v = vars[key];
    return v === undefined || v === null || v === "" ? whole : String(v);
  });
}

/** Register every prompt found in `prompts/`. Returns the number registered. */
export function registerPrompts(server: McpServer): number {
  let files: string[];
  try {
    files = readdirSync(PROMPTS_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return 0; // no prompts directory shipped — fine
  }

  let count = 0;
  for (const file of files) {
    let parsed: ParsedPrompt | null;
    try {
      parsed = parseFrontmatter(readFileSync(join(PROMPTS_DIR, file), "utf8"));
    } catch (e) {
      logger.warn(`Skipping prompt ${file}: ${String(e)}`);
      continue;
    }
    if (!parsed) {
      logger.warn(`Skipping prompt ${file}: missing or invalid frontmatter`);
      continue;
    }

    const argsSchema: Record<string, z.ZodType> = {};
    for (const arg of parsed.arguments) {
      const s = z.string().describe(arg.description ?? "");
      argsSchema[arg.name] = arg.required ? s : s.optional();
    }

    server.registerPrompt(
      parsed.name,
      { title: parsed.title, description: parsed.description, argsSchema },
      (args: Record<string, unknown>) => ({
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: substitute(parsed.body, args) },
          },
        ],
      }),
    );
    count++;
  }
  return count;
}
