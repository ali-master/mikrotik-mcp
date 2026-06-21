# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **Bun-native MCP server** that exposes MikroTik **RouterOS** (over SSH) as several
hundred risk-annotated tools, one module per RouterOS scope, so an MCP client can
read and configure a router in natural language. Runs on **Bun ≥ 1.3** — there is no
npm/Node build; do not introduce `child_process`/OS-shell usage (all device I/O is
SSH via `ssh2`). The live tool/module counts are whatever the catalog
(`src/tools/index.ts`) holds.

## Commands

```bash
bun test                          # all tests (offline — no device needed)
bun test tests/catalog.test.ts    # a single test file
bun test -t "quoteValue"          # tests matching a name
bun run test:types                # tsc --noEmit typecheck
bun run lint                      # eslint (antfu config); lint:fix to autofix
bun run gen                       # regenerate schemas/ + docs/tools-reference.md
bun run build                     # bunup -> dist/cli.js
bun run start                     # serve (stdio transport by default)
bun run inspect                   # MCP Inspector against the server
```

Pre-commit gate used in this repo: `bun run test:types && bun test && bun run lint`.
Run each **un-piped** in the `&&` chain — piping through `tail` masks the exit code
and lets a failing check pass the gate.

## Architecture

**One choke point for the device.** Every tool reaches RouterOS through
`executeMikrotikCommand(command, ctx)` in `src/core/connector.ts` — never by
opening SSH directly. It routes the command through Safe Mode's persistent session
when active (`src/ssh/safe-mode.ts`), otherwise a fresh one-shot SSH channel
(`src/ssh/client.ts`). The target device rides on `ctx.device`.

**Command construction is the injection boundary.** Build every device command
with the `Cmd` builder in `src/core/routeros.ts` (`.set/.opt/.flag/.bool/.raw/
.build`) — never string-concatenate user input. `quoteValue` quotes/escapes any
non-bare-safe value, including control chars/newlines (a raw `\n` would otherwise
terminate the command mid-string over the SSH exec channel). Detect device-side
failures in handler output with `looksLikeError()`; other shared helpers are
`whereClause()`, `isEmpty()`, `yesno()`, `commandUnsupported()`,
`containsRawParserError()`.

**Tools.** Each `src/tools/<scope>.ts` exports a `ToolModule` (an array of
`defineTool({...})`, `src/core/registry.ts`). A tool has: `name` (snake_case,
globally unique), `title`, `description` (the prompt the model reads to decide when
to call), `annotations` (one risk preset: `READ` / `WRITE` / `WRITE_IDEMPOTENT` /
`DESTRUCTIVE` / `DANGEROUS`), `inputSchema` (a Zod raw shape), and
`handler(args, ctx) => string`. In multi-device setups the registry auto-injects an
optional `device` enum and peels it off before the handler runs; a backstop turns
raw RouterOS parser errors into `isError` results.

**The catalog is the single source of truth.** `src/tools/index.ts` `moduleCatalog`
registers every module exactly once (`{label, slug, group, description, tools}`).
The catalog test enforces unique slugs, unique snake_case tool names, valid
Zod→JSON-Schema, and `moduleCatalog.length === allToolModules.length`.

**Config & runtime.** `src/config.ts` `loadConfig()` layers defaults → env → CLI
flags: single-device (`MIKROTIK_*`), multi-device (`--config`/`MIKROTIK_CONFIG_FILE`
JSON or `MIKROTIK_DEVICES`), an `mcp` transport block, and an optional `s3` block.
The result is installed once via `setConfig()` and read globally through
`src/core/runtime.ts` (`getConfig`, `getDevice`, `resolveDeviceName`) — handlers get
connection details from runtime, not parameters.

**Tests are offline.** `tests/` validate the static catalog shape and the command
builder against no live device. "Tested" here means these pass — on-device behavior
is not exercised in CI.

## Adding or changing a tool module

1. Create `src/tools/<scope>.ts` exporting a `ToolModule`. **Mirror the closest
   existing sibling** — the per-tool shape is highly regular: `add/create`, `list`,
   `get`, `update`, `remove`, often `enable/disable`; `remove` does a `count-only`
   existence check then `[find ...]`; ordered rules (firewall-style) verify creation
   by the returned `.id` or a last-row `count`.
2. Register it in `src/tools/index.ts` (import + one `moduleCatalog` entry).
3. Run the gate, then `bun run gen` and commit the regenerated `schemas/` and
   `docs/tools-reference.md` (and `schemas/config.schema.json` if the config schema
   changed) — these generated artifacts are tracked.

Note: eslint's `perfectionist/sort-named-imports` enforces a specific named-import
order (e.g. `yesno` before `quoteValue`); new modules commonly trip it — run
`bun run lint:fix`.
