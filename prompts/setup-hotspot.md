---
name: setup-hotspot
title: Build a captive portal hotspot
description: Deploy a complete guest hotspot with captive portal, DHCP, per-user bandwidth limits, and optional voucher codes.
arguments:
  - name: interface
    description: The interface for the hotspot (e.g. "wlan1", "ether5", "vlan-guest"). This is where guest clients connect.
    required: true
  - name: dns_name
    description: DNS name for the captive portal (e.g. "hotspot.local"). Optional.
    required: false
---

Deploy a complete captive-portal hotspot on this MikroTik device. The hotspot
will have its own DHCP, gateway, bandwidth limits, and optional voucher-based
access. Confirm the plan before applying changes.

Hotspot interface: {{interface}}
Portal DNS name: {{dns_name}}

Steps:

1. **Check the interface.** Call `get_interface` for {{interface}} to confirm it
   exists and is running. For a wireless interface, verify an SSID is set with
   `list_wireless_interfaces`.

2. **Build the hotspot.** Call `build_guest_hotspot` with:
   - The interface ({{interface}}).
   - A gateway subnet (e.g. 10.5.50.1/24).
   - DHCP pool for clients.
   - Per-user bandwidth limits (e.g. 5M download / 2M upload).
   - The DNS name for portal redirect ({{dns_name}} if provided).
     This creates the IP address, DHCP server, hotspot instance, and profile in
     one step.

3. **Generate vouchers (optional).** Call `generate_hotspot_vouchers` to create
   time-limited or usage-limited access codes. Present the voucher codes in a
   table with their limits and expiry.

4. **Walled garden.** If the portal needs to allow access to specific sites
   without login (e.g. a terms page, payment gateway), add walled-garden entries.

5. **Firewall.** Verify the hotspot network is isolated from the management and
   internal networks — the hotspot setup should handle this, but confirm with
   `list_filter_rules`.

6. **Test.** Verify the portal redirect works — a client connecting to
   {{interface}} should be redirected to the login page before getting internet
   access.

Report the hotspot configuration: gateway, DHCP range, bandwidth limits, voucher
codes (if generated), and the portal URL.
