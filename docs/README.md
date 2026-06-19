# Documentation

`@usex/mikrotik-mcp` is a Bun-native [Model Context Protocol](https://modelcontextprotocol.io)
server that exposes **310 tools across 31 modules** for managing MikroTik
RouterOS devices over SSH — firewall, NAT, routing, DHCP, DNS, wireless, QoS,
and a complete **VPN suite** (WireGuard, IPsec, L2TP, PPTP, SSTP, OpenVPN, and
GRE/IPIP/EoIP/VXLAN tunnels).

It runs on **Bun ≥ 1.3**, is written in TypeScript, and its environment
variables are byte-for-byte compatible with the legacy Python server, so an
existing deployment can swap binaries without touching its configuration.

## Contents

| Doc | What's inside |
|-----|---------------|
| [Getting started](./getting-started.md) | Install, verify connectivity with `auth-check`, first run. |
| [Configuration](./configuration.md) | Every env var and CLI flag, defaults, key vs. password auth, log levels. |
| [Transports](./transports.md) | `stdio` vs `streamable-http` vs `sse`, the `/mcp` and `/health` endpoints, DNS-rebinding protection. |
| [Connecting clients](./connecting-clients.md) | Claude Desktop config, generic stdio clients, HTTP clients. |
| [Safe Mode](./safe-mode.md) | Transactional config changes that auto-revert on disconnect. |
| **[VPN guide](./vpn-guide.md)** | Every MikroTik VPN/tunnel type, when to use it, and the tools + prompts that build it. |
| [Architecture](./architecture.md) | How the layers fit together: CLI → config → registry → tools → connector → SSH. |
| [Prompts](./prompts.md) | The 8 built-in MCP prompts and how clients invoke them. |
| [Security](./security.md) | Credential handling, DNS-rebinding, risk annotations, client-side gating. |
| [Development](./development.md) | Tests, type-checking, building, generating schemas and docs, project layout. |
| [Docker](./docker.md) | A minimal Bun-based image and how to pass `MIKROTIK_*` env vars. |
| **[Tool reference](./tools-reference.md)** | The full, generated catalog of all 310 tools with parameters and risk levels. |

## Quick links

- Tool catalog (machine-readable): [`schemas/tool-catalog.json`](../schemas/tool-catalog.json)
- Per-tool input schemas: [`schemas/tools/<name>.json`](../schemas/tools/)
- Config schema: [`schemas/config.schema.json`](../schemas/config.schema.json)
