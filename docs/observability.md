# Observability dashboard

An optional, **localhost-only** web dashboard that intercepts every MCP tool
call the LLM makes against this server and shows it in real time — what was
called, with which inputs, what came back, how long it took, and whether it
failed — alongside live analytics. It is **off by default** and runs alongside
whichever MCP transport you use (`stdio`, `streamable-http`, or `sse`).

## What it captures

Every tool invocation flows through one choke point in the registry, so the
dashboard sees **all** of them — all ~650 tools, every transport. For each call
it records:

- tool name, title and **risk class** (READ / WRITE / WRITE_IDEMPOTENT /
  DESTRUCTIVE / DANGEROUS),
- target **device**, transport, start time and **duration**,
- **input arguments** and **text output** (see redaction below),
- success / error (with the error message), and whether the result drove an MCP
  App view.

### Secrets are redacted

Tool inputs can contain credentials (passwords, private keys, pre-shared keys,
tokens). Before anything is stored or streamed, any value under a sensitive key
(`pass`, `secret`, `private-key`, `passphrase`, `psk`, `token`, …) is replaced
with `«redacted»`. Bodies are also truncated to a configurable budget. Set
`captureBody=false` to keep only metadata (no input/output bodies at all).

## Enable it

```bash
# CLI flags
bun run start --dashboard                       # default 127.0.0.1:9090
bun run start --dashboard --dashboard-port 9090 --dashboard-db ./events.db

# or env vars
MIKROTIK_DASHBOARD__ENABLED=true bun run start
```

Then open **http://127.0.0.1:9090/** in a browser on the same machine.

> The dashboard binds to `127.0.0.1` (loopback) by default, so it is reachable
> only from your own device. Keep it that way unless you deliberately put it
> behind authentication and a trusted network.

## Configuration

| Env var | Flag | Default | Meaning |
|---|---|---|---|
| `MIKROTIK_DASHBOARD__ENABLED` | `--dashboard` | `false` | Master switch. When off, zero overhead and no SQLite is loaded. |
| `MIKROTIK_DASHBOARD__HOST` | `--dashboard-host` | `127.0.0.1` | Bind host (loopback by default). |
| `MIKROTIK_DASHBOARD__PORT` | `--dashboard-port` | `9090` | Bind port. |
| `MIKROTIK_DASHBOARD__DB_PATH` | `--dashboard-db` | `./mikrotik-mcp-events.db` | SQLite file; `:memory:` for an ephemeral store. |
| `MIKROTIK_DASHBOARD__MAX_EVENTS` | `--dashboard-max-events` | `100000` | Retention cap; older rows are pruned. |
| `MIKROTIK_DASHBOARD__CAPTURE_BODY` | `--dashboard-capture-body` | `true` | Record redacted input/output bodies. |
| `MIKROTIK_DASHBOARD__MAX_BODY_BYTES` | `--dashboard-max-body-bytes` | `16384` | Per-body truncation budget. |
| `MIKROTIK_DASHBOARD__TOKEN` | `--dashboard-token` | _(none)_ | Optional bearer token; when set, the page, API and WebSocket all require it. |

A `dashboard` block in a JSON config file (`--config`) overrides env/flags:

```json
{
  "devices": { "default": { "host": "192.168.88.1", "password": "…" } },
  "dashboard": { "enabled": true, "port": 9090, "dbPath": "./events.db" }
}
```

With a token set, open `http://127.0.0.1:9090/?token=YOUR_TOKEN` — the page
forwards it to the API and the live WebSocket automatically.

## Storage — Bun-native SQLite

Events persist to `bun:sqlite` (no external database, no extra dependency). The
schema is one flat `events` table; analytics are computed in pure TypeScript
over a time window, so they stay fast and fully unit-tested. The module is
imported lazily — `bun:sqlite` is only loaded when the dashboard is enabled.

## The UI

- **Stat cards** — calls in window, calls/min, error rate, avg / p95 / p99
  latency, distinct tools, output volume.
- **Calls over time** — stacked ok/error time-series.
- **Breakdowns** — top tools (count + p95 + errors), by-risk and status donuts,
  by-device bars, and a recent-errors panel.
- **Live feed** — every call streams in over a WebSocket; filter by tool, risk,
  device, status or free-text search; pause/resume; export the visible rows to
  CSV or JSON.
- **Detail drawer** — click any row for full metadata plus the redacted input
  and complete output, with copy buttons.

## API

The dashboard is backed by a small JSON API on the same port (handy for scripts):

| Endpoint | Returns |
|---|---|
| `GET /api/stats?window=<ms>&buckets=<n>` | Computed analytics over the window. |
| `GET /api/events?limit&offset&tool&risk&device&status&q&since&until` | Filtered, paginated events. |
| `GET /api/event/:id` | One event with full (redacted) bodies. |
| `GET /api/meta` | Filter facets (tools/devices), totals, live-client count. |
| `GET /api/stream` | WebSocket — pushes `{type:"event", event}` for every new call. |
| `GET /health` | Liveness probe (`OK`). |

All routes require the bearer token when one is configured (the WebSocket reads
it from `?token=`).
