---
name: design-qos-policy
title: Design a traffic shaping policy
description: Build a QoS queue hierarchy from business requirements — define traffic classes, priorities, and bandwidth guarantees with preview before apply.
arguments:
  - name: wan_bandwidth
    description: WAN bandwidth in download/upload format (e.g. "100M/50M", "1G/1G").
    required: true
  - name: classes
    description: Describe traffic classes and priorities (e.g. "VoIP=highest, video conferencing=high, web=normal, bulk downloads=low"). If omitted, a sensible default is used.
    required: false
---

Design and deploy a traffic shaping (QoS) policy on this MikroTik device that
prioritizes important traffic and prevents bulk downloads from saturating the
link. All changes are previewed before applying.

WAN bandwidth: {{wan_bandwidth}}
Traffic classes: {{classes}}

Steps:

1. **Understand the network.** Call `list_interfaces` and `list_ip_addresses` to
   identify the WAN interface. Call `list_queue_trees` and `list_simple_queues`
   to check if any QoS is already in place.

2. **Design the policy.** Translate {{classes}} into a queue hierarchy:
   - A parent queue on the WAN interface capped at {{wan_bandwidth}}.
   - Child queues for each traffic class with appropriate priorities,
     guaranteed minimum bandwidth, and burst settings.
     Call `apply_traffic_shaping` in **preview mode** to see the queue tree
     structure before applying.

3. **Review the queue tree.** Present a table showing:
   - Each traffic class, its priority level, guaranteed bandwidth, max bandwidth.
   - Packet marks or connection marks used to classify traffic.
   - Mangle rules that mark traffic into classes.

4. **Apply.** With user approval, deploy the QoS policy.

5. **Verify.** Call `list_queue_trees` to confirm the hierarchy is in place.
   Monitor briefly to see traffic flowing through the queues.

6. **Capacity planning (optional).** Call `forecast_link_saturation` on the WAN
   interface to project when the current link will reach capacity at the observed
   growth rate — useful for planning upgrades.

Report the complete QoS policy: queue hierarchy, classification rules, and
bandwidth allocations per class.
