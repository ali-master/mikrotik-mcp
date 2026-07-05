---
name: backup-and-document
title: Back up and document the configuration
description: Create a safe restore point and produce a human-readable inventory of the router's configuration.
arguments: []
---

Create a restore point for this MikroTik device and then write up a clear,
human-readable summary of how it's configured. This is read-mostly: the only
change is creating a backup/export.

1. **Local snapshot (zero device footprint)** — `capture_config_snapshot` first.
   This stores a text `/export` in the MCP host's local database — no file is
   written on the router's flash. Give it a descriptive `label` (e.g. `pre-audit`).
2. **Device restore point** — `create_backup` (binary, for full restore) and
   `create_export` (text `.rsc`, for review/diff). List them with `list_backups`.
3. **Inventory** — gather the configuration with read tools and organize it:
   - System: `get_system_identity`, `get_system_resources`, `get_routerboard`,
     `get_installed_packages`.
   - L2/L3: `list_interfaces`, `list_vlan_interfaces`, `list_bridges`,
     `list_ip_addresses`, `list_ip_pools`.
   - Services: `list_dhcp_servers`, `get_dns_settings`, `list_dns_static`,
     `list_ip_services`.
   - Routing: `list_routes`, `get_routing_table`.
   - Security: `list_filter_rules`, `list_nat_rules`, `list_address_lists`,
     `list_users`, `list_certificates`.
   - VPN/QoS: `list_wireguard_interfaces` + `list_wireguard_peers`,
     `list_simple_queues`, `list_queue_trees`.
   - Containers: `list_containers` (if the container feature is enabled).
   - Automation: `list_schedulers`, `list_scripts`.

Produce a structured Markdown report: a one-paragraph overview, a table of
interfaces and addressing, the firewall posture, and a "things worth reviewing"
section (defaults left in place, disabled-but-present rules, expiring certs —
check `list_certificates` for any expiring within 30 days).
Reference the snapshot id and backup/export filenames you created so the user
knows their restore points.
