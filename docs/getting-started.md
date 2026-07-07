# Getting started

This server bridges an MCP client (Claude Desktop, an agent, your own code) and
a MikroTik RouterOS device. It connects to the device over **SSH** and exposes
its configuration surface as MCP tools.

## Prerequisites

- **[Bun](https://bun.sh) ≥ 1.3** — the only runtime requirement.
- A reachable **RouterOS device** with SSH enabled (`/ip service` → `ssh`).
- SSH credentials: either a **password** or an **SSH private key** for a user
  with the privileges you intend to manage.

## Install

### Global install (recommended)

```bash
bun add -g @usex/mikrotik-mcp
```

This puts a `mikrotik-mcp` binary on your `PATH`.

```bash
mikrotik-mcp --version      # prints the version, e.g. 1.0.0
mikrotik-mcp --help         # usage and all flags
```

### From source

```bash
git clone https://github.com/mikrotik-mcp/mikrotik-mcp.git
cd mikrotik-mcp
bun install
bun run start               # runs src/cli.ts serve (stdio transport)
```

## Verify connectivity

Before wiring up a client, confirm the server can actually reach your device.
`auth-check` opens an SSH connection, runs two read-only probe commands
(`/system identity print` and `/system resource print`), prints the result, and
exits.

```bash
MIKROTIK_HOST=192.168.88.1 \
MIKROTIK_USERNAME=admin \
MIKROTIK_PASSWORD='your-password' \
mikrotik-mcp auth-check
```

Equivalent using flags (flags override env vars):

```bash
mikrotik-mcp auth-check \
  --host 192.168.88.1 \
  --username admin \
  --password 'your-password'
```

A successful run prints `Connection OK.` followed by the device identity and
resource output. On failure it prints `Connection FAILED.` and exits with a
non-zero status — check host, credentials, SSH port, and reachability.

See [Configuration](./configuration.md) for every connection option, including
key-file authentication.

## First run

Start the server. By default it speaks the **stdio** transport, which is what
Claude Desktop and most local MCP clients expect:

```bash
mikrotik-mcp serve          # or just: mikrotik-mcp
```

All diagnostic logging goes to **stderr**; stdout is reserved for the JSON-RPC
protocol stream. On startup you'll see (on stderr) a line like:

```
[mikrotik-mcp] INFO MCP server ready on stdio — 229 tools, 5 prompts
```

## Explore the catalog

List every registered tool with its risk level without connecting to a device:

```bash
mikrotik-mcp tools
```

This prints `RISK  name  title` rows and a final `229 tools across 24 modules`
summary. For the full reference with parameters, see the
[tool reference](./tools-reference.md).

## Next steps

- [Connect a client](./connecting-clients.md) (Claude Desktop, HTTP, custom).
- [Choose a transport](./transports.md) for local vs. networked deployments.
- [Use Safe Mode](./safe-mode.md) to make risky changes reversible.
