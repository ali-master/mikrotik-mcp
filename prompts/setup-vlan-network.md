---
name: setup-vlan-network
title: Design and deploy VLAN segments
description: Create isolated VLAN segments with gateway addressing, DHCP, and inter-VLAN firewall policy — previewed before apply.
arguments:
  - name: vlans
    description: Describe the VLANs you need — e.g. "management=10, staff=20, IoT=30, guest=40" (name=VLAN-ID).
    required: true
  - name: trunk_interface
    description: The interface to use as a VLAN trunk (e.g. "ether1", "bridge"). If omitted, the main bridge is used.
    required: false
---

Design and deploy a VLAN-segmented network on this MikroTik device. Each VLAN
gets its own subnet, gateway IP, DHCP server, and firewall isolation. All changes
are previewed before applying.

VLANs requested: {{vlans}}
Trunk interface: {{trunk_interface}}

Follow these steps — confirm the plan before applying any changes:

1. **Understand the current layout.** Call `list_interfaces`, `list_bridges`,
   `list_ip_addresses`, and `list_dhcp_servers` to understand what exists.

2. **Design each VLAN segment.** For each VLAN in {{vlans}}, call
   `design_network_segment` in **preview mode** with:
   - VLAN ID and name.
   - A subnet (auto-assigned or specified — e.g. 10.10.{vlan_id}.0/24).
   - Gateway address (.1 in the subnet).
   - DHCP pool range.
   - Isolation policy (whether this VLAN can reach others).

3. **Review the plan.** Present a summary table:
   - VLAN ID, name, subnet, gateway, DHCP range.
   - Firewall rules that will be created for inter-VLAN isolation.
   - Bridge/trunk configuration changes.

4. **Apply.** With user approval, run `design_network_segment` again with apply
   mode for each VLAN.

5. **Verify.** Call `list_vlan_interfaces` to confirm VLANs are created,
   `list_ip_addresses` for gateway IPs, `list_dhcp_servers` for DHCP, and
   `list_filter_rules` for the isolation firewall rules.

Report the complete VLAN map and any follow-ups (e.g. switch port VLAN
assignments, wireless SSID-to-VLAN mappings).
