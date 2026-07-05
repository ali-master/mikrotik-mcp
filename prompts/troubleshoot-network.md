---
name: troubleshoot-network
title: Intelligent root-cause diagnosis
description: Autonomously investigate a network problem across connectivity, routing, firewall, NAT, DHCP, DNS, and system resources — ranked hypotheses with fix commands.
arguments:
  - name: symptom
    description: Describe the problem in plain language (e.g. "users on VLAN 20 can't reach the internet", "BGP session to 10.0.0.1 keeps dropping").
    required: true
  - name: scope
    description: Limit investigation to specific dimensions (comma-separated). Options — connectivity, interfaces, routing, firewall, nat, dhcp, dns, resources, logs, vpn. Omit for full investigation.
    required: false
---

Investigate a network problem on this MikroTik device using the intelligent
root-cause analyzer. It autonomously probes across up to 10 dimensions and
correlates evidence into ranked hypotheses.

Symptom: {{symptom}}
Investigation scope: {{scope}}

Follow this workflow:

1. **Automated diagnosis.** Call `diagnose` with the symptom description (and
   optional scope). It will autonomously investigate connectivity, interfaces,
   routing (BGP/OSPF), firewall, NAT, ARP/DHCP, DNS, CPU/memory, logs, and VPN —
   then return ranked root-cause hypotheses with confidence levels.

2. **Review hypotheses.** Present each hypothesis with:
   - Confidence level (high/medium/low).
   - The evidence that supports it.
   - The specific fix command(s) provided.

3. **Deep-dive if needed.** For the top hypothesis:
   - If routing is involved, call `trace_path` for hop-by-hop path analysis.
   - If logs suggest cascading failures, call `correlate_events` to surface the
     chain (e.g. interface down → OSPF neighbor lost → route withdrawn).

4. **Quick fix option.** Call `suggest_fix` for a condensed list of actionable
   commands with one-line explanations — useful when you just need the fix
   without the full diagnostic report.

5. **Apply fix (with approval).** Present the recommended fix commands and apply
   only after the user approves. Use Safe Mode for firewall changes.

Do not apply any changes without user approval.
