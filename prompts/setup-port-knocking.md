---
name: setup-port-knocking
title: Hide management behind port knocking
description: Conceal SSH/Winbox/API behind a secret port-knock sequence that temporarily opens access from the knocking IP.
arguments:
  - name: services
    description: Which services to protect (comma-separated, e.g. "ssh,winbox,api"). Default is SSH and Winbox.
    required: false
  - name: knock_ports
    description: Comma-separated port sequence for the knock (e.g. "1234,5678,9012"). If omitted, random ports are chosen.
    required: false
---

Set up port knocking on this MikroTik device to hide management services behind a
secret port sequence. Only IPs that complete the knock sequence get temporary
access — everyone else sees the ports as closed.

Services to protect: {{services}}
Knock port sequence: {{knock_ports}}

Steps:

1. **Check current access.** Call `list_ip_services` to see which management
   services are enabled. Call `list_filter_rules` with `chain=input` to review
   existing access rules.

2. **Set up the knock sequence.** Call `setup_port_knock` with the services to
   protect and the port sequence (or let it generate random ports). This creates:
   - Firewall address-lists that track the knock progress per source IP.
   - Filter rules that move an IP through the stages as it hits each port.
   - A final rule that allows access to the protected services for IPs that
     complete the full sequence (with a timeout, typically 15 minutes).
   - A drop rule for the protected services from all other IPs.

3. **Verify the knock.** Test that:
   - Without knocking, the protected ports are unreachable.
   - After sending packets to the knock ports in order, access opens.
   - After the timeout, access closes again.

4. **Document.** Present the knock sequence clearly so administrators can save it
   somewhere secure. Include example commands to knock from a client:

   ```
   nmap -Pn --host-timeout 100 -p PORT1 ROUTER_IP
   nmap -Pn --host-timeout 100 -p PORT2 ROUTER_IP
   nmap -Pn --host-timeout 100 -p PORT3 ROUTER_IP
   ```

5. **Safety warning.** Remind the user to keep a backup access method (e.g.
   MAC-Telnet from a local network, or a trusted IP that bypasses the knock)
   to avoid being locked out.

Do not apply changes without user approval.
