#!/usr/bin/env bun
/**
 * Generates the JSON-Schema artifacts under `schemas/` directly from the live
 * tool definitions and config schema. Because the schemas are *derived* from
 * the same Zod shapes the server validates against, they can never drift from
 * the implementation.
 *
 * Run with: `bun run gen:schemas`
 *
 * Outputs:
 *   schemas/config.schema.json     — runtime configuration (MIKROTIK_* / flags)
 *   schemas/tool-catalog.json      — every tool: name, risk, title, description, input JSON Schema
 *   schemas/tools/<name>.json       — one input JSON Schema per tool
 *   schemas/README.md              — what these files are
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { MikrotikConfigSchema } from "../src/config";
import { SCHEMAS_DIR } from "../src/paths";
import { allToolModules } from "../src/tools";
import { VERSION } from "../src/version";

function riskOf(a: {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}): string {
  if (a.readOnlyHint) return "read";
  if (a.destructiveHint) return a.idempotentHint ? "destructive" : "dangerous";
  return a.idempotentHint ? "write-idempotent" : "write";
}

const toolsDir = join(SCHEMAS_DIR, "tools");
rmSync(toolsDir, { recursive: true, force: true });
mkdirSync(toolsDir, { recursive: true });

const catalog: unknown[] = [];
let count = 0;

for (const mod of allToolModules) {
  for (const tool of mod) {
    const shape = tool.inputSchema ?? {};
    const inputSchema = z.toJSONSchema(z.object(shape as z.ZodRawShape), {
      target: "draft-2020-12",
    });
    const entry = {
      name: tool.name,
      title: tool.title,
      risk: riskOf(tool.annotations),
      annotations: tool.annotations,
      description: tool.description,
      inputSchema,
    };
    catalog.push(entry);
    writeFileSync(
      join(toolsDir, `${tool.name}.json`),
      `${JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", title: tool.name, ...inputSchema }, null, 2)}\n`,
    );
    count++;
  }
}

writeFileSync(
  join(SCHEMAS_DIR, "tool-catalog.json"),
  `${JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", version: VERSION, generated: "by scripts/gen-schemas.ts — do not edit by hand", toolCount: count, tools: catalog }, null, 2)}\n`,
);

writeFileSync(
  join(SCHEMAS_DIR, "config.schema.json"),
  `${JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", title: "MikrotikConfig", ...z.toJSONSchema(MikrotikConfigSchema, { target: "draft-2020-12" }) }, null, 2)}\n`,
);

writeFileSync(
  join(SCHEMAS_DIR, "README.md"),
  `# Schemas

Machine-readable JSON Schemas for \`@usex/mikrotik-mcp\`, **generated** from the
TypeScript source by \`scripts/gen-schemas.ts\` (\`bun run gen:schemas\`). Do not
edit by hand — regenerate instead.

| File | Contents |
|------|----------|
| \`config.schema.json\` | The runtime configuration object (env vars / CLI flags). |
| \`tool-catalog.json\` | Every one of the ${count} tools: \`name\`, \`risk\`, \`title\`, \`description\`, and input JSON Schema. |
| \`tools/<name>.json\` | The input JSON Schema for a single tool. |

\`risk\` is derived from the MCP tool annotations:
\`read\` · \`write\` · \`write-idempotent\` · \`destructive\` · \`dangerous\`.
`,
);

// eslint-disable-next-line node/prefer-global/process
process.stdout.write(
  `Generated schemas for ${count} tools into ${SCHEMAS_DIR}\n`,
);
