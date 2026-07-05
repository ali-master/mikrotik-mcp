---
name: setup-threat-feeds
title: Subscribe to threat intelligence feeds
description: Import external threat-intel IP blocklists into firewall address-lists with automatic scheduled updates.
arguments:
  - name: feed_url
    description: URL of the threat feed (one IP per line). If omitted, a well-known public feed will be suggested.
    required: false
  - name: list_name
    description: Firewall address-list name to populate (e.g. "threat-blocklist"). Default is chosen automatically.
    required: false
---

Subscribe this MikroTik device to an external threat intelligence feed that
automatically imports malicious IPs into a firewall address-list and keeps it
updated on a schedule.

Feed URL: {{feed_url}}
Address-list name: {{list_name}}

Steps:

1. **Choose the feed.** If {{feed_url}} is not provided, suggest a well-known
   public feed (e.g. Spamhaus DROP, Emerging Threats, or abuse.ch). Explain what
   the feed contains and its update frequency.

2. **Subscribe.** Call `subscribe_threat_feed` with the feed URL and address-list
   name. This creates a scheduled script that periodically fetches the feed and
   imports the IPs into the specified address-list.

3. **Verify the import.** Call `list_address_lists` and check that the list exists
   and contains entries. Report the count.

4. **Create firewall rules.** Add drop rules referencing the address-list:
   - `create_filter_rule` in the `forward` chain: drop traffic with
     `src-address-list={{list_name}}` or `dst-address-list={{list_name}}`.
   - `create_filter_rule` in the `input` chain: drop incoming connections from
     the list.
     Use Safe Mode (`enable_safe_mode`) before adding firewall rules.

5. **Confirm the schedule.** Call `list_schedulers` to verify the update script
   is scheduled (e.g. every 6 or 24 hours).

6. **Report.** The feed URL, address-list name, number of entries imported,
   firewall rules created, and the update schedule.

To remove a feed later, use `remove_threat_feed`.
