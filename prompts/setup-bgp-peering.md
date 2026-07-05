---
name: setup-bgp-peering
title: Set up BGP peering
description: Configure a BGP connection to a peer — upstream provider, IX, or another router — with templates, filters, and session verification.
arguments:
  - name: peer_address
    description: Neighbor IP address (e.g. "198.51.100.1").
    required: true
  - name: remote_as
    description: Peer AS number (e.g. "65000").
    required: true
  - name: local_as
    description: Local AS number. If omitted, defaults to the existing BGP AS or the router-id-based AS.
    required: false
---

Configure a BGP peering session on this MikroTik device. This sets up the BGP
template, connection, and verification. Confirm the plan before applying.

Peer address: {{peer_address}}
Remote AS: {{remote_as}}
Local AS: {{local_as}}

Steps:

1. **Check existing BGP config.** Call `list_bgp_templates` and
   `list_bgp_connections` to see if BGP is already configured. Call
   `list_ip_addresses` to confirm we have a local IP in the same subnet as the
   peer (or a route to reach it).

2. **Create a BGP template.** Call `add_bgp_template` with:
   - `as={{local_as}}` (or the existing AS).
   - Address families (typically `ip` for IPv4 unicast; add `ipv6` if needed).
   - Hold time, keepalive, and other timers as appropriate.

3. **Create the BGP connection.** Call `add_bgp_connection` with:
   - `remote.address={{peer_address}}`
   - `remote.as={{remote_as}}`
   - `local.role` — set to `ebgp` for external peers, `ibgp` for internal.
   - Link to the template created in step 2.

4. **Firewall.** Ensure TCP port 179 (BGP) is allowed from {{peer_address}} in
   the `input` chain. Call `create_filter_rule` using Safe Mode.

5. **Verify the session.** Call `list_bgp_sessions` — the session should reach
   `established` state. If it stays in `connect` or `active`, check:
   - Firewall rules on both sides.
   - IP reachability (`ping` {{peer_address}}).
   - AS number and address-family mismatch.

6. **Check routes.** Call `list_bgp_advertisements` to see what this router is
   advertising. Call `list_routes` to see BGP-learned routes from the peer.

7. **Routing filters (optional).** If you need to filter incoming or outgoing
   prefixes, set up routing filter rules to accept/reject specific prefixes.

Report the session status, routes received/advertised, and any warnings.
