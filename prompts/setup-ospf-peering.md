---
name: setup-ospf-peering
title: Set up OSPF dynamic routing
description: Configure OSPF instances, areas, and interface templates for dynamic route exchange between MikroTik routers.
arguments:
  - name: router_id
    description: The OSPF router ID for this device (e.g. "10.0.0.1"). Typically a loopback or management IP.
    required: true
  - name: area
    description: OSPF area ID (e.g. "0.0.0.0" for backbone, "0.0.0.1" for a stub area). Default is backbone.
    required: false
  - name: interfaces
    description: Which interfaces to run OSPF on (comma-separated, e.g. "ether1,ether2,bridge"). If omitted, you'll be asked.
    required: false
---

Configure OSPF dynamic routing on this MikroTik device so it automatically
exchanges routes with neighboring OSPF routers. Confirm the plan before applying.

Router ID: {{router_id}}
OSPF area: {{area}}
Interfaces: {{interfaces}}

Steps:

1. **Inventory.** Call `get_system_identity`, `list_interfaces`, and
   `list_ip_addresses` to understand the device topology. Call
   `list_ospf_instances` to check if OSPF is already configured.

2. **Create the OSPF instance.** Call `add_ospf_instance` with:
   - `router_id={{router_id}}`
   - Redistribution settings if needed (e.g. redistribute connected, static).

3. **Create the area.** Call `add_ospf_area` with the area ID ({{area}} or
   `0.0.0.0` for backbone). For stub areas, set `type=stub`.

4. **Add interface templates.** For each interface in {{interfaces}}, call
   `add_ospf_interface_template` with:
   - The interface name and area.
   - Network type (broadcast for Ethernet, point-to-point for tunnels).
   - Cost if you want to influence path selection.
   - Authentication if required (MD5 or simple password).

5. **Firewall.** Ensure OSPF traffic is allowed — add a `create_filter_rule` in
   the `input` chain accepting protocol 89 (OSPF) on the relevant interfaces.
   Use Safe Mode for firewall edits.

6. **Verify adjacency.** Wait a few seconds, then call `list_ospf_neighbors` to
   confirm the neighbor relationship reaches `Full` state. If stuck in
   `ExStart` or `2-Way`, check MTU, area, and authentication match.

7. **Check routes.** Call `list_routes` and filter for OSPF routes to confirm
   remote subnets are being learned.

Report the OSPF instance, area, interface assignments, neighbor status, and
learned routes.
