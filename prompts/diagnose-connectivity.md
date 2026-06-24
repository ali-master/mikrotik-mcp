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

Target that is unreachable: {{target}}
Affected segment/interface: {{source_interface}}

Diagnose in layers, stating what each step rules in or out:

1. **Link** — `list_interfaces` (is the relevant interface `running`?), and for
   PoE/SFP links check status. `get_interface` for details.
2. **Addressing** — `list_ip_addresses`; confirm the segment has a valid gateway
   IP and the WAN has an address (DHCP/PPPoE/static).
3. **Routing** — `get_routing_table`, then `check_route_path` toward {{target}} to
   see which route/gateway would be used and whether it's active.
4. **Name resolution** — if {{target}} is a hostname, `resolve_dns` and
   `get_dns_settings`.
5. **Reachability** — `ping` {{target}} from the router (and with `src_address`
   set to the segment's gateway if relevant); `traceroute` to find where it stops.
6. **Firewall / NAT** — `list_filter_rules` and `list_nat_rules`; look for a drop
   in `forward` or a missing `srcnat`/masquerade for the segment. Check
   `list_address_lists` if rules reference one.
7. **Logs** — `search_logs` for the interface/subnet and `get_system_events`.

Conclude with the single most likely root cause, the evidence for it, and the
specific tool call(s) that would fix it (for the user to approve).
