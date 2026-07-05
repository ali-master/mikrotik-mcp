---
name: diagnose-connectivity
title: Diagnose a connectivity problem
description: Systematically troubleshoot why a host, subnet, or the internet is unreachable from a MikroTik router.
arguments:
  - name: target
    description: What's unreachable — an IP, hostname, or subnet (e.g. 8.8.8.8, example.com, 192.168.50.0/24).
    required: true
  - name: source_interface
    description: The interface/segment the affected clients are on (e.g. bridge, vlan50). Optional.
    required: false
---

Troubleshoot a connectivity issue on a MikroTik RouterOS device, reasoning from
the bottom of the stack up. Use read-only tools only — do not change config until
you've localized the fault and the user approves a fix.

**Quick alternative:** for a fully automated diagnosis, call `diagnose` with the
symptom description — it autonomously investigates across 10 dimensions and
returns ranked root-cause hypotheses with fix commands. Use the manual steps below
when you need more control or the automated diagnosis needs a deeper look.

Target that is unreachable: {{target}}
Affected segment/interface: {{source_interface}}

Diagnose in layers, stating what each step rules in or out:

1. **Link** — `list_interfaces` (is the relevant interface `running`?), and for
   PoE/SFP links check status. `get_interface` for details.
2. **Addressing** — `list_ip_addresses`; confirm the segment has a valid gateway
   IP and the WAN has an address (DHCP/PPPoE/static).
3. **ARP & DHCP** — `list_dhcp_servers` and `list_dhcp_leases` on the affected
   segment; confirm clients are getting leases and ARP is resolving.
4. **Routing** — `get_routing_table`, then `check_route_path` toward {{target}} to
   see which route/gateway would be used and whether it's active.
5. **Name resolution** — if {{target}} is a hostname, `resolve_dns` and
   `get_dns_settings`.
6. **Reachability** — `ping` {{target}} from the router (and with `src_address`
   set to the segment's gateway if relevant); `traceroute` to find where it stops.
7. **Firewall / NAT** — `list_filter_rules` and `list_nat_rules`; look for a drop
   in `forward` or a missing `srcnat`/masquerade for the segment. Check
   `list_address_lists` if rules reference one.
8. **Logs & event correlation** — `search_logs` for the interface/subnet and
   `get_system_events`. If multiple log entries suggest cascading failures (e.g.
   interface down → OSPF neighbor lost → route withdrawn), use `correlate_events`
   to surface the chain.

Conclude with the single most likely root cause, the evidence for it, and the
specific tool call(s) that would fix it (for the user to approve).
