# Development

The project is plain TypeScript on Bun — no build step is needed to run it from
source. Bun runs the `.ts` entry points directly.

## Prerequisites

- **[Bun](https://bun.sh) ≥ 1.3** (the repo pins `bun@1.3.14` via
  `packageManager`).

```bash
git clone https://github.com/mikrotik-mcp/mikrotik-mcp.git
cd mikrotik-mcp
bun install
```

## Common scripts

All scripts are defined in `package.json`.

| Command                     | What it does                                                        |
| --------------------------- | ------------------------------------------------------------------- |
| `bun run start`             | Run the server from source (`src/cli.ts serve`, stdio).             |
| `bun run auth-check`        | Run the SSH connectivity probe from source.                         |
| `bun run inspect`           | Open the [MCP Inspector](./inspector.md) UI against the dev server. |
| `bun run inspect:config`    | Inspector UI using `mcp-inspector.config.json`.                     |
| `bun run inspect:cli`       | Headless `tools/list` via the Inspector (CI smoke test).            |
| `bun test`                  | Run the test suite with Bun's built-in test runner.                 |
| `bun run test:types`        | Type-check the whole project (`tsc --noEmit`).                      |
| `bun run build`             | Bundle to `dist/` with **bunup** and mark the CLI executable.       |
| `bun run dev`               | `bunup --watch` — rebuild on change.                                |
| `bun run gen:schemas`       | Regenerate the JSON Schemas under `schemas/`.                       |
| `bun run gen:docs`          | Regenerate `docs/tools-reference.md`.                               |
| `bun run gen`               | Run both generators (`gen:schemas` then `gen:docs`).                |
| `bun run lint` / `lint:fix` | ESLint over `src/**/*.ts`.                                          |
| `bun run format`            | Prettier over all `*.ts`.                                           |

## Testing & type-checking

```bash
bun test            # behavior
bun run test:types  # tsc --noEmit, no emit, just type safety
```

## Building

```bash
bun run build       # -> dist/ (bundled), chmod +x dist/cli.js
```

The published package ships `dist/`, `prompts/`, and `schemas/` (the `files`
array in `package.json`). The `bin` entry maps `mikrotik-mcp` →
`dist/cli.js`. `prepack` rebuilds before publishing.

## Generated schemas & docs

The `schemas/` JSON Schemas and `docs/tools-reference.md` are **derived from the
live source** — the same Zod shapes and tool definitions the server validates
against — so they can't drift from the implementation. Regenerate after changing
any tool or the config schema:

```bash
bun run gen         # schemas + docs
```

Generators:

- `scripts/gen-schemas.ts` → `schemas/config.schema.json`,
  `schemas/tool-catalog.json`, `schemas/tools/<name>.json`, `schemas/README.md`.
- `scripts/gen-tool-docs.ts` → `docs/tools-reference.md`.

Do not hand-edit those outputs; edit the source and regenerate.

## Project layout

```
src/
  cli.ts            CLI entry point (serve / auth-check / tools / version)
  config.ts         env + flag resolution -> validated MikrotikConfig
  server.ts         assembles the McpServer (tools + prompts + instructions)
  logger.ts         leveled logger -> stderr (MIKROTIK_LOG_LEVEL)
  paths.ts          resolves prompts/ and schemas/ dirs (dev or dist)
  version.ts        version (from package.json) + server name
  index.ts          library entry (dist/index.js)
  core/
    registry.ts     defineTool() + risk presets + registration
    connector.ts    the single command choke point (Safe Mode routing)
    routeros.ts     Cmd builder + injection-safe quoting helpers
    context.ts      per-call logging context
    runtime.ts      process-wide config store (setConfig/getConfig)
  ssh/
    client.ts       ssh2 client: run() one-shot, shell() persistent
    safe-mode.ts    persistent Ctrl+X Safe Mode session manager
  transport/
    stdio.ts        stdio transport
    http.ts         streamable-http / sse via Bun.serve, /mcp + /health
  tools/            24 subsystem modules + index.ts (allToolModules)
  prompts/
    index.ts        markdown-frontmatter prompt loader
prompts/            the prompt markdown files (shipped)
schemas/            generated JSON Schemas (shipped)
scripts/            gen-schemas.ts, gen-tool-docs.ts
docs/               this documentation
```

## Conventions

- A tool's identity is its `name` field; the registry throws on duplicates.
- Tools never print to stdout — logging goes through `ctx`/`logger` to stderr,
  keeping the stdio JSON-RPC stream clean.
- New tools use `defineTool()` with the correct risk preset and build commands
  with `Cmd` (never string concatenation) so quoting stays injection-safe.
