---
name: Bug report
about: A tool, the server, or a transport didn't behave as expected
title: "[bug] "
labels: bug
assignees: ''
---

**Describe the bug**
A clear and concise description of what went wrong.

**Which area?**
- [ ] A specific tool (give its name, e.g. `create_ipsec_peer`)
- [ ] Connection / `auth-check` (SSH to the device)
- [ ] Transport (stdio / streamable-http / sse)
- [ ] Safe Mode (`enable_safe_mode` / `commit_safe_mode` / `rollback_safe_mode`)
- [ ] A prompt (e.g. `choose-vpn-solution`)
- [ ] CLI (`serve` / `tools` / `version`)
- [ ] Library / programmatic use
- [ ] Schemas / docs generation (`bun run gen`)

**Tool call or command**
The tool name + arguments your client invoked, or the CLI command you ran:

```jsonc
// tool: create_vlan_interface
{ "name": "vlan100", "vlan_id": 100, "interface": "ether1" }
```

```bash
mikrotik-mcp auth-check
```

**What happened**
What the tool returned / the error message. If it's an SSH or RouterOS error,
paste the relevant text. Re-run with `MIKROTIK_LOG_LEVEL=debug` and include the
stderr log lines (redact passwords, keys, public IPs, and PSKs).

**Expected behavior**
What you expected instead. If it's a RouterOS command issue, the exact CLI
command you'd run on the device by hand is very helpful.

**Environment**
- mikrotik-mcp version: [`mikrotik-mcp version`, e.g. 1.0.0]
- Bun version: [`bun --version`]
- OS: [e.g. macOS 15, Ubuntu 24.04]
- Transport: [stdio / streamable-http / sse]
- MCP client: [Claude Desktop / Claude Code / other]
- RouterOS version: [`/system resource print`, e.g. 7.16]
- Device model: [e.g. hAP ax³, CCR2004, CHR]
- Auth: [password / SSH key]

**Additional context**
Anything else — was Safe Mode active? a specific VLAN/VPN/firewall setup? Did
the same command work when run directly over SSH on the device?
