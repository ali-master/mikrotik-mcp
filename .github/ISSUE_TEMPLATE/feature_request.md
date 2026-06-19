---
name: Feature request
about: Suggest a new tool, module, prompt, or improvement
title: "[feat] "
labels: enhancement
assignees: ''
---

**What problem does this solve?**
A clear and concise description of the gap. Ex. "There's no tool to manage
`/routing ospf` instances, so I can't configure dynamic routing from my client."

**Proposed solution**
What you'd like to happen.

**Area**
- [ ] New tool / module (a RouterOS subsystem not covered yet)
- [ ] New parameter on an existing tool
- [ ] VPN / tunneling coverage (WireGuard / IPsec / L2TP / PPTP / SSTP / OpenVPN / GRE-IPIP-EoIP-VXLAN)
- [ ] A new guided prompt (`prompts/`)
- [ ] Transport / connection (stdio, HTTP, SSE, auth)
- [ ] Safe Mode behaviour
- [ ] Output formatting / structured output
- [ ] Developer experience (CLI, library API, docs, schemas)
- [ ] Other

**RouterOS reference (if proposing a new tool)**
The CLI path and command(s) the tool would run, so it can be implemented
faithfully. Example:

```
/routing ospf instance add name=... router-id=...
/routing ospf instance print
```

Also note the appropriate risk level: read / write / write-idempotent /
destructive / dangerous.

**Alternatives considered**
Any other approaches you weighed (e.g. running it via an existing tool, a script).

**Additional context**
RouterOS version where this applies, device models, links to MikroTik docs, or
an example of the configuration you're trying to manage.
