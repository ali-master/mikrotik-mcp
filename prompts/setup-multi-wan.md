---
name: setup-multi-wan
title: Set up multi-WAN failover or load balancing
description: Configure resilient multi-WAN with health-checked active-passive failover or ECMP load balancing across two or more uplinks.
arguments:
  - name: wan_interfaces
    description: Comma-separated WAN interface names (e.g. "ether1,ether2" or "ether1,lte1").
    required: true
  - name: mode
    description: "failover" for active-passive with health checks, or "loadbalance" for ECMP. Default is failover.
    required: false
---

Set up multi-WAN resilience on this MikroTik device so it stays online even when
a link goes down. Confirm the plan with the user before applying changes.

WAN interfaces: {{wan_interfaces}}
Mode: {{mode}}

Steps:

1. **Inventory the WANs.** Call `list_interfaces` and `list_ip_addresses` to
   confirm each WAN interface exists, is running, and has an address (static,
   DHCP, or PPPoE). Note each WAN's gateway.

2. **Deploy the multi-WAN setup.**
   - For **failover**: call `setup_wan_failover` with the WAN interfaces. This
     creates health-check routes (pinging reliable targets like 1.1.1.1 and
     8.8.8.8) and distance-based route priorities — the secondary WAN activates
     only when the primary's health check fails.
   - For **load balancing**: call `setup_wan_loadbalance` with the WANs. This
     creates ECMP routes that spread traffic across both uplinks, with health
     checks to pull a dead link out of the pool automatically.

3. **Firewall / NAT.** Ensure each WAN has a masquerade/srcnat rule so outbound
   traffic uses the correct source address. Check `list_nat_rules`.

4. **Verify failover.** Test by temporarily disabling the primary WAN interface
   and confirming traffic switches to the secondary:
   - `ping` 8.8.8.8 continuously from the router.
   - `disable_interface` on the primary WAN, verify ping continues via secondary.
   - `enable_interface` to restore it.
   - Check `get_routing_table` to confirm route priorities are correct.

5. **Report.** The WAN priority order, health check targets, failover timing,
   and NAT rules for each WAN.
