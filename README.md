<div align="center">
  <img src="assets/logo.svg" alt="@usex/mikrotik-mcp" width="440" />
  <p><strong>A Bun-native MCP server that turns one or more MikroTik routers into 706 tools your AI can drive.</strong><br/>
  Firewall · routing · DHCP/DNS · wireless · QoS · and a complete VPN suite — over SSH, with transactional Safe Mode.</p>

  <p>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-7C3AED.svg"></a>
    <img alt="Runtime: Bun" src="https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.3-06B6D4.svg">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-6366F1.svg">
    <img alt="MCP" src="https://img.shields.io/badge/MCP-706%20tools-1F2937.svg">
    <a href="docs/"><img alt="Docs" src="https://img.shields.io/badge/docs-reference-7C3AED.svg"></a>
  </p>
</div>

---

`@usex/mikrotik-mcp` exposes **MikroTik RouterOS** as **706 [Model Context Protocol](https://modelcontextprotocol.io)
tools across 111 modules**, so an AI client (Claude Desktop, Claude Code, any MCP
client) can read and configure your router in plain language. It speaks to the
device over **SSH** — no agent, no API package to install on RouterOS — runs on
**[Bun](https://bun.sh)**, and validates every tool call against a Zod schema.

Every tool is **risk-annotated** (read / write / destructive) so clients can gate
what runs, and risky changes can be wrapped in **Safe Mode** — RouterOS holds them
in memory and auto-reverts if your session drops, so you can't lock yourself out.

```jsonc
// claude_desktop_config.json
{
  "mcpServers": {
    "mikrotik": {
      "command": "mikrotik-mcp",
      "env": {
        "MIKROTIK_HOST": "192.168.88.1",
        "MIKROTIK_USERNAME": "admin",
        "MIKROTIK_PASSWORD": "your-password",
      },
    },
  },
}
```

> _"Show me the firewall input chain, then block SSH from the WAN under safe mode."_
> _"Build an IKEv2 site-to-site tunnel to 203.0.113.5 for 192.168.20.0/24."_
> _"Why can't VLAN 50 reach the internet?"_

## Why it's different

- 🧰 **Breadth** — 706 tools covering the whole device: L2 (bridge, VLAN, wireless,
  PoE), L3 (addressing, routing, DHCP, DNS), security (firewall, NAT, address-lists,
  certificates), QoS (queues), and system ops (users, logs, backups, scheduler).
- 🔐 **A complete VPN suite** — WireGuard, IPsec (IKEv1/IKEv2), L2TP, PPTP, SSTP,
  OpenVPN, plus GRE/IPIP/EoIP/VXLAN tunnels. With a `choose-vpn-solution` prompt
  that picks the right one for you. See the **[VPN guide](docs/vpn-guide.md)**.
- 🛟 **Safe Mode** — a real transactional window (`enable_safe_mode` →
  changes → `commit_safe_mode`/`rollback_safe_mode`) backed by a persistent SSH
  session. Auto-reverts on disconnect.
- 🚦 **Risk-annotated tools** — `readOnlyHint` / `destructiveHint` let clients
  auto-approve reads and prompt on writes.
- 🧱 **Injection-safe by construction** — a command builder quotes/escapes every
  value, so a hostname like `LAN; /system reset` can never split into a second
  command.
- 🖧 **Multiple devices** — define named routers and the AI targets one per call
  (a validated `device` argument). Configure **both ends of a tunnel** from one
  conversation. See **[docs/multi-device.md](docs/multi-device.md)**.
- 🪜 **SSH jump hosts** — reach a router with no exposed port by tunnelling
  through another via `jumpVia` (ProxyJump/bastion) — commands, Safe Mode and
  file upload all ride the hop. No new WAN port.
- 🤖 **Guided prompts** — 9 built-in workflows (harden, diagnose, guest Wi-Fi, VPNs,
  cross-device tunnels, backup & document) that turn an intent into tool calls.

## Quickstart

```bash
# 1. Install (requires Bun ≥ 1.3 — https://bun.sh)
bun add -g @usex/mikrotik-mcp

# 2. Point it at your router and verify SSH connectivity
MIKROTIK_HOST=192.168.88.1 MIKROTIK_USERNAME=admin MIKROTIK_PASSWORD=•••• \
  mikrotik-mcp auth-check

# 3. List the catalog (name · risk · title)
mikrotik-mcp tools

# 4. Run it (stdio by default — wire it into your MCP client)
mikrotik-mcp serve
```

**Try it without an AI client** — open the official [MCP Inspector](docs/inspector.md)
against the server (from source):

```bash
bun run inspect        # opens the Inspector UI to browse/run all 706 tools
```

**Prefer SSH keys over a password?** Point the server at a key file instead — and
add a passphrase if the key is encrypted:

```bash
MIKROTIK_HOST=192.168.88.1 MIKROTIK_USERNAME=admin \
MIKROTIK_KEY_FILENAME=~/.ssh/id_ed25519 \
MIKROTIK_KEY_PASSPHRASE=•••• \
  mikrotik-mcp auth-check     # prints "Auth mode: SSH key"
```

The key (file via `--key-filename` or inline PEM via `--private-key`) takes
precedence over a password. Full configuration reference:
**[docs/configuration.md](docs/configuration.md)**.

### From source

```bash
git clone https://github.com/ali-master/mikrotik-mcp && cd mikrotik-mcp
bun install
bun run start            # serve from source
bun run build            # bundle to dist/
```

## The tool catalog

**706 tools across 111 modules.** Full, always-current reference (parameters +
risk per tool) is generated from source: **[docs/tools-reference.md](docs/tools-reference.md)**.

| Group                    | Tools | Modules                                                                                                    |
| ------------------------ | ----: | ---------------------------------------------------------------------------------------------------------- |
| **Interfaces**           |    41 | interfaces, VLAN, bridge, wireless, PoE                                                                    |
| **Addressing & Routing** |    46 | IP addresses, IP pools, routing, DHCP, DNS                                                                 |
| **Dynamic Routing**      |    99 | router-id, settings, tables, rules, next-hops, filters, BFD, BGP, OSPF, RIP, PIM-SM, IGMP proxy, GMP, RPKI |
| **Security**             |    34 | firewall filter, NAT, address-lists, certificates, IP services                                             |
| **VPN & Tunneling**      |    96 | WireGuard, IPsec, PPP, L2TP, PPTP, SSTP, OpenVPN, GRE/IPIP/EoIP/VXLAN                                      |
| **QoS**                  |    19 | queue types, queue trees, simple queues                                                                    |
| **System & Ops**         |   102 | system, network tools, scheduler/scripts, users, logs, backup, Safe Mode                                   |

## VPN & tunneling — expert coverage

Every MikroTik VPN technology, modeled the way RouterOS actually layers them (the
PPP-based VPNs share one `/ppp` backend for users and addressing):

| Need                                | Use                     | Build it with                                                                          |
| ----------------------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| MikroTik ↔ MikroTik, modern clients | **WireGuard**           | `create_wireguard_interface`, `add_wireguard_peer`, `generate_wireguard_client_config` |
| Interop site-to-site / native IKEv2 | **IPsec**               | `create_ipsec_{profile,peer,identity,proposal,policy}`, `get_ipsec_active_peers`       |
| Built-in OS VPN clients             | **L2TP/IPsec**          | `set_l2tp_server`, `create_ppp_secret`, `create_ppp_profile`                           |
| Through restrictive firewalls       | **SSTP** (TLS)          | `set_sstp_server`, `create_sstp_client`                                                |
| Cross-platform OpenVPN              | **OpenVPN**             | `set_ovpn_server`, `create_ovpn_client`                                                |
| Route / L2-bridge between sites     | **GRE/IPIP/EoIP/VXLAN** | `create_gre_tunnel`, `create_eoip_tunnel`, `create_vxlan_tunnel`                       |

Not sure which? Invoke the **`choose-vpn-solution`** prompt and the server
recommends one and outlines the build. Details: **[docs/vpn-guide.md](docs/vpn-guide.md)**.

## Manage multiple devices

Give each router a name and the AI can drive them all from one conversation —
exactly what you need to **set up a tunnel between two MikroTiks and test it from
both ends**. Point the server at a JSON file (or `MIKROTIK_DEVICES`):

```jsonc
// devices.json
{
  "defaultDevice": "site-a",
  "devices": {
    "site-a": { "host": "203.0.113.10", "username": "admin", "keyFilename": "/keys/site-a" },
    "site-b": { "host": "198.51.100.20", "username": "admin", "password": "••••" },
  },
}
```

```bash
mikrotik-mcp serve --config ./devices.json
mikrotik-mcp devices        # site-a (default) · site-b
mikrotik-mcp auth-check     # probes every device
```

When more than one device is configured, **every tool gains an optional `device`
argument** (a validated enum of your names); omit it to use the default. The AI
discovers names with `list_mikrotik_devices`, and **Safe Mode is per-device** so
each router commits independently. The **`setup-tunnel-between-sites`** prompt
drives the whole both-ends flow. Full guide: **[docs/multi-device.md](docs/multi-device.md)**.

```jsonc
// the AI calls a tool against a specific router:
// create_wireguard_interface { "device": "site-a", "name": "wg-to-b", "listen_port": 13231 }
```

**Behind a bastion?** Reach a router with no exposed SSH port by jumping through
another (OpenSSH-style ProxyJump) — `jumpVia` names a configured device to tunnel
through; commands, Safe Mode and SFTP upload all ride the hop:

```jsonc
"home-ax3": { "host": "10.10.30.100", "username": "admin", "jumpVia": "hex" }
```

The bastion router needs SSH TCP forwarding enabled (`/ip ssh set
forwarding-enabled=local`). See **[docs/multi-device.md](docs/multi-device.md#ssh-jump-hosts-bastion--proxyjump)**.

## Built-in prompts

MCP **prompts** are one-click guided workflows. This server ships 9 — authored as
Markdown in [`prompts/`](prompts/), so you can edit or add your own without
touching code:

`harden-router` · `diagnose-connectivity` · `setup-guest-wifi` ·
`choose-vpn-solution` · `setup-wireguard-vpn` · `setup-ipsec-site-to-site` ·
`setup-l2tp-ipsec-roadwarrior` · `setup-tunnel-between-sites` · `backup-and-document`

See **[docs/prompts.md](docs/prompts.md)**.

## Transports

| Transport           | When                              | Run                                                              |
| ------------------- | --------------------------------- | ---------------------------------------------------------------- |
| **stdio** (default) | Claude Desktop, local MCP clients | `mikrotik-mcp serve`                                             |
| **streamable-http** | Remote / shared, behind a proxy   | `mikrotik-mcp serve --transport streamable-http --mcp-port 8000` |
| **sse**             | Legacy HTTP clients               | `mikrotik-mcp serve --transport sse`                             |

HTTP transports expose `POST /mcp` and a `GET /health` check, with DNS-rebinding
protection that reconciles with your bind host automatically. See
**[docs/transports.md](docs/transports.md)**.

## Safe Mode

```text
enable_safe_mode → (make changes) → commit_safe_mode    # persist
                                   → rollback_safe_mode  # discard
```

While active, every change is held in memory; if the SSH session drops (e.g. a
firewall rule that locks you out), RouterOS reverts everything automatically.
Commands issued during the window are routed through the same persistent session.
See **[docs/safe-mode.md](docs/safe-mode.md)**.

## Configuration

Connection and transport settings come from `MIKROTIK_*` env vars or matching CLI
flags (highest precedence last: defaults → env → flags).

| Variable                      | Flag               | Default     | Purpose                                                                                              |
| ----------------------------- | ------------------ | ----------- | ---------------------------------------------------------------------------------------------------- |
| `MIKROTIK_HOST`               | `--host`           | `127.0.0.1` | RouterOS host                                                                                        |
| `MIKROTIK_USERNAME`           | `--username`       | `admin`     | SSH user                                                                                             |
| `MIKROTIK_PORT`               | `--port`           | `22`        | SSH port                                                                                             |
| `MIKROTIK_PASSWORD`           | `--password`       | —           | SSH password _(or use a key →)_                                                                      |
| `MIKROTIK_KEY_FILENAME`       | `--key-filename`   | —           | SSH private-key file path                                                                            |
| `MIKROTIK_PRIVATE_KEY`        | `--private-key`    | —           | Inline private key (PEM)                                                                             |
| `MIKROTIK_KEY_PASSPHRASE`     | `--key-passphrase` | —           | Passphrase for an encrypted key                                                                      |
| `MIKROTIK_JUMP_HOST`          | `--jump-host`      | —           | SSH bastion to tunnel through ([jump hosts](docs/multi-device.md#ssh-jump-hosts-bastion--proxyjump)) |
| `MIKROTIK_CONFIG_FILE`        | `--config`         | —           | JSON file of named devices ([multi-device](docs/multi-device.md))                                    |
| `MIKROTIK_DEVICES`            | `--devices`        | —           | Inline JSON of named devices                                                                         |
| `MIKROTIK_MCP__TRANSPORT`     | `--transport`      | `stdio`     | `stdio` / `streamable-http` / `sse`                                                                  |
| `MIKROTIK_MCP__PORT`          | `--mcp-port`       | `8000`      | HTTP bind port                                                                                       |
| `MIKROTIK_DASHBOARD__ENABLED` | `--dashboard`      | `false`     | Real-time observability dashboard ([docs](docs/observability.md))                                    |

Full table (incl. HTTP host, allow-lists, timeouts, `MIKROTIK_LOG_LEVEL`):
**[docs/configuration.md](docs/configuration.md)**.

### Observability dashboard (optional)

A localhost-only web dashboard that intercepts **every** tool call the LLM makes
— live feed of inputs/outputs (secrets redacted), latency percentiles, error
rate and per-tool/risk/device analytics — persisted to a Bun-native SQLite store
and served on its own port alongside any transport:

```bash
mikrotik-mcp serve --dashboard          # → http://127.0.0.1:9090
```

See **[docs/observability.md](docs/observability.md)**.

## Beyond the catalog

On top of the per-scope tools, the server ships higher-level workflows:

- **[Change Plan & Dry-Run](docs/change-plan.md)** — preview intended commands as
  a terraform-style plan (risk-scored, lock-out-aware, safely reordered), then
  `apply_plan` runs them under Safe Mode, shows the **exact `/export` diff**, and
  commits only if the device is still reachable (auto-reverts a lock-out).
- **[Config Snapshots](docs/config-snapshots.md)** — store `/export` snapshots on
  the host and **time-travel diff** any two, or one against the live device.
- **[Firewall Audit](docs/firewall-audit.md)** — `firewall_audit` finds shadowed,
  overly-broad, missing-default-drop, duplicate and dead rules, risk-scored, with
  one-click fixes in MCP App hosts.
- **[Packet Capture Studio](docs/packet-capture.md)** — stream mirrored packets to
  the host as TZSP, decode them live in the dashboard, and export `.pcap`.
- **[Discovery](docs/discovery.md)** — `bun run discover` lists MikroTik devices on
  the LAN by MAC (MNDP); the dashboard draws a live **topology map**.
- **[Config Studio](docs/config-studio.md)** — edit the config JSON in the
  dashboard with autocomplete, validation, and safe-apply auto-rollback.

## Schemas

`schemas/` ships machine-readable JSON Schemas, **generated from the TypeScript
source** (`bun run gen:schemas`) so they can never drift:

- `schemas/tool-catalog.json` — every tool with risk, description, and input schema
- `schemas/tools/<name>.json` — per-tool input schema
- `schemas/config.schema.json` — the runtime configuration

## Documentation

| Doc                                                           |                                                             |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| [Getting started](docs/getting-started.md)                    | Install, verify, first run                                  |
| [Configuration](docs/configuration.md)                        | Every env var & flag                                        |
| [Multiple devices](docs/multi-device.md)                      | Manage several routers; per-call targeting                  |
| [Connecting clients](docs/connecting-clients.md)              | Claude Desktop, stdio, HTTP                                 |
| [Transports](docs/transports.md)                              | stdio / HTTP / SSE, DNS-rebinding                           |
| **[Observability](docs/observability.md)**                    | Real-time dashboard: live feed + analytics, SQLite          |
| [Safe Mode](docs/safe-mode.md)                                | Transactional changes                                       |
| **[Change Plan & Dry-Run](docs/change-plan.md)**              | Preview commands, apply with the exact diff + auto-rollback |
| **[Config Snapshots](docs/config-snapshots.md)**              | `/export` snapshots + time-travel diff                      |
| **[Firewall Audit](docs/firewall-audit.md)**                  | Shadowed/broad/dead rules, risk-scored                      |
| **[Packet Capture Studio](docs/packet-capture.md)**           | Live TZSP capture + pcap export                             |
| **[Discovery](docs/discovery.md)**                            | `bun run discover`, MNDP neighbours, topology map           |
| **[Config Studio](docs/config-studio.md)**                    | Edit config in the dashboard with autocomplete              |
| **[VPN guide](docs/vpn-guide.md)**                            | Every tunnel type + how to build it                         |
| [Prompts](docs/prompts.md)                                    | The 9 guided workflows                                      |
| [Architecture](docs/architecture.md)                          | How it's built                                              |
| [Security](docs/security.md)                                  | Credentials, risk gating                                    |
| [Tool reference](docs/tools-reference.md)                     | The full generated catalog                                  |
| [MCP Inspector](docs/inspector.md)                            | Test tools/prompts in the UI or CLI                         |
| [Development](docs/development.md) · [Docker](docs/docker.md) | Build, test, deploy                                         |

## Development

```bash
bun run test:types   # tsc --noEmit
bun test             # unit tests
bun run gen          # regenerate schemas/ + docs/tools-reference.md from source
bun run build        # bundle to dist/
```

See **[docs/development.md](docs/development.md)** and [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Talks to RouterOS over SSH using credentials you supply; nothing is sent anywhere
else. Tool values are quoted/escaped to prevent console-command injection.
Destructive and dangerous tools are annotated so clients can require confirmation,
and a plaintext-password-in-a-container warning nudges you toward key files or
secrets. Details: **[docs/security.md](docs/security.md)**. Only point this at
devices you're authorized to manage.

## License

[MIT](LICENSE). Reuse freely. No warranty.

---

<div align="center">
  <img src="assets/logo-icon.svg" width="56" alt="" /><br/>
  Made with ❤️ by <a href="https://github.com/ali-master">Ali Torki</a>
</div>
