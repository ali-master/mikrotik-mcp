---
name: setup-guest-wifi
title: Set up an isolated guest network
description: Create a segmented guest VLAN/network with its own DHCP, internet access, and isolation from the LAN.
arguments:
  - name: subnet
    description: The guest subnet in CIDR, e.g. 192.168.80.0/24.
    required: true
  - name: vlan_id
    description: VLAN ID for the guest segment, e.g. 80. Optional if using a flat interface.
    required: false
  - name: wan_interface
    description: The interface that reaches the internet (for the masquerade rule).
    required: true
---

Build an **isolated guest network** on this MikroTik device. Guests must reach the
internet but must NOT reach the LAN or the router's management. Plan the whole
change first, show it to the user, then apply it under Safe Mode.

Guest subnet: {{subnet}}
Guest VLAN ID: {{vlan_id}}
WAN interface: {{wan_interface}}

Proposed build (adapt to what you discover with `list_interfaces`,
`list_ip_addresses`, `list_filter_rules`):

1. **Segment** — if a VLAN is requested, `create_vlan_interface` (vlan_id
   {{vlan_id}}) on the LAN bridge/trunk; otherwise pick a dedicated interface.
2. **Gateway IP** — `add_ip_address` using the first usable address of {{subnet}}.
3. **DHCP** — `create_dhcp_pool`, `create_dhcp_network` (gateway + DNS), and
   `create_dhcp_server` bound to the guest interface.
4. **NAT** — ensure a `create_nat_rule` masquerade exists for {{subnet}} out
   {{wan_interface}}.
5. **Isolation (the important part)** — in the `forward` chain via
   `create_filter_rule`:
   - allow {{subnet}} → WAN (established/related + new),
   - **drop {{subnet}} → LAN subnets (RFC1918)**,
     and in the `input` chain drop {{subnet}} → router except DHCP/DNS. Consider an
     `add_address_list_entry` list named `guest` to keep the rules tidy.
6. **Verify** — re-list the rules and confirm ordering; `enable_safe_mode` before
   applying, test, then `commit_safe_mode`.

Present the plan as an ordered list of exact tool calls with arguments before
executing anything.
