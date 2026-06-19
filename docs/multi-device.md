# Multiple Devices

One server instance can manage **several named MikroTik routers**, and the AI
chooses which one each tool call runs on. This is what makes cross-device work —
like building a tunnel between two routers and testing it from both ends —
possible in a single conversation.

## Defining devices

Single-device setups need nothing new: the `MIKROTIK_*` variables define a device
named `default` (see [configuration](./configuration.md)).

For multiple devices, provide a `devices` map via **either** a JSON config file
or an inline env var.

### A config file (`--config` / `MIKROTIK_CONFIG_FILE`)

```json
{
  "defaultDevice": "site-a",
  "devices": {
    "site-a": {
      "host": "203.0.113.10",
      "username": "admin",
      "keyFilename": "/keys/site-a",
      "description": "HQ edge router"
    },
    "site-b": {
      "host": "198.51.100.20",
      "username": "admin",
      "password": "••••••",
      "description": "Branch office"
    }
  }
}
```

```bash
mikrotik-mcp serve --config ./devices.json
# or
MIKROTIK_CONFIG_FILE=./devices.json mikrotik-mcp serve
```

### Inline (`MIKROTIK_DEVICES`)

```bash
MIKROTIK_DEVICES='{"defaultDevice":"site-a","devices":{"site-a":{"host":"203.0.113.10","keyFilename":"/keys/site-a"},"site-b":{"host":"198.51.100.20","password":"••••"}}}' \
  mikrotik-mcp serve
```

Each device accepts the same fields as the single-device config: `host`,
`username`, `password`, `port`, `keyFilename`, `privateKey`, `keyPassphrase`,
`timeoutMs`, plus an optional `description`. A bare `{ "name": { … } }` map (no
`defaultDevice`) is also accepted — the first key becomes the default.

You can also combine: the legacy `MIKROTIK_*` vars contribute a `default` device
alongside the named ones from the file/env.

## How the AI targets a device

When **more than one** device is configured, every tool automatically gains an
optional **`device`** parameter — a validated enum of your device names:

```jsonc
// tool: create_wireguard_interface
{ "device": "site-a", "name": "wg-to-b", "listen_port": 13231 }
```

Omit `device` to use the default. With a single device the parameter isn't added
at all, so single-device usage is unchanged.

The AI discovers the names with the **`list_mikrotik_devices`** tool (or you can
run `mikrotik-mcp devices`):

```
$ mikrotik-mcp devices
site-a (default)   admin@203.0.113.10:22 [auth: key] — HQ edge router
site-b             admin@198.51.100.20:22 [auth: password] — Branch office
```

## Safe Mode is per-device

Each router has its own [Safe Mode](./safe-mode.md) session. `enable_safe_mode`
with `device=site-a` opens a transactional window on **site-a only**; `site-b`
is unaffected and commits independently. This lets you stage risky firewall
changes on both ends of a tunnel and roll back one side without touching the other.

## Verifying connectivity

`mikrotik-mcp auth-check` probes **every** configured device and reports each:

```
[site-a] Connection OK.
 name: HQ-Edge
[site-b] Connection OK.
 name: Branch-RB5009

2 device(s) checked.
```

## Example: a tunnel between two routers

The guided prompt **`setup-tunnel-between-sites`** ([prompts](./prompts.md)) drives
the whole flow — inventory both ends, pick a technology, configure each side with
its `device`, open the firewall under per-device Safe Mode, and verify with `ping`
from both routers. See also the [VPN guide](./vpn-guide.md).
