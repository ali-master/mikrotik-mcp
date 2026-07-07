# MikroTik MCP Changelog

## [Initial Version] - {PR_MERGE_DATE}

- Full parity with the MikroTik MCP observability dashboard across 15 commands: Overview,
  Devices, Clients, RADIUS & UM, Topology, Packet Capture, Snapshots, Drift Guard, Change
  Plan, S3 Backups, Backups, Modules, Config, Memory and Live Feed.
- Real-time Live Feed over WebSocket (with SSE fallback) and live client-traffic / packet
  polling.
- Native config editor with validate / preview / timed safe-apply, version history and a
  schema-driven field guide.
- Full RADIUS & User Manager CRUD, client management (block/allow/pin/limits), backups and
  drift baselines — every destructive action gated behind a confirmation.
