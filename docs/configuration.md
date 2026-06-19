# Configuration

Every setting can be supplied as an **environment variable** or a **CLI flag**.
The environment variable names are byte-for-byte compatible with the legacy
Python server, so existing deployments work unchanged.

## Resolution order

Settings are resolved with the following precedence (later wins):

```
built-in defaults  →  environment variables  →  command-line flags
```

So a `--host` flag overrides `MIKROTIK_HOST`, which overrides the `127.0.0.1`
default.

## Connection settings

These control the SSH connection to the RouterOS device. On their own they define
a single device named `default`.

| Setting | CLI flag | Environment variable | Default |
|---------|----------|----------------------|---------|
| Host / IP | `--host` | `MIKROTIK_HOST` | `127.0.0.1` |
| SSH username | `--username` | `MIKROTIK_USERNAME` | `admin` |
| SSH password | `--password` | `MIKROTIK_PASSWORD` | _(empty)_ |
| SSH port | `--port` | `MIKROTIK_PORT` | `22` |
| Private key file path | `--key-filename` | `MIKROTIK_KEY_FILENAME` | _(unset)_ |
| Inline private key (PEM) | `--private-key` | `MIKROTIK_PRIVATE_KEY` | _(unset)_ |
| Private key passphrase | `--key-passphrase` | `MIKROTIK_KEY_PASSPHRASE` | _(unset)_ |
| SSH connect timeout (ms) | `--timeout-ms` | `MIKROTIK_TIMEOUT_MS` | `10000` |

## Multiple devices

To manage more than one router from a single server (e.g. to build a tunnel
between two), define a **named devices map**. The AI then targets a device per
call via an injected `device` argument.

| Setting | CLI flag | Environment variable |
|---------|----------|----------------------|
| Named-devices JSON file | `--config` | `MIKROTIK_CONFIG_FILE` |
| Named-devices inline JSON | `--devices` | `MIKROTIK_DEVICES` |

Full guide, file format, and the per-device Safe Mode behaviour:
**[Multiple devices](./multi-device.md)**.

## Transport settings

These control how MCP clients reach the server. See [Transports](./transports.md)
for the full behavior.

| Setting | CLI flag | Environment variable | Default |
|---------|----------|----------------------|---------|
| Transport | `--transport` | `MIKROTIK_MCP__TRANSPORT` (alias `MCP_TRANSPORT`) | `stdio` |
| HTTP bind host | `--mcp-host` | `MIKROTIK_MCP__HOST` | `0.0.0.0` |
| HTTP bind port | `--mcp-port` | `MIKROTIK_MCP__PORT` | `8000` |
| Allowed `Host` headers | `--mcp-allowed-hosts` | `MIKROTIK_MCP__ALLOWED_HOSTS` | _(empty)_ |
| Allowed `Origin` headers | `--mcp-allowed-origins` | `MIKROTIK_MCP__ALLOWED_ORIGINS` | _(empty)_ |

Transport values are `stdio`, `streamable-http`, or `sse`. The HTTP bind host,
port, and allow-lists only apply to the HTTP transports; they're ignored for
`stdio`.

The `__` (double underscore) in the env var names is the nested-key delimiter
inherited from the Python server's settings model.

## Logging

| Setting | Environment variable | Default | Values |
|---------|----------------------|---------|--------|
| Log verbosity | `MIKROTIK_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

All log output is written to **stderr** (never stdout, which carries the
JSON-RPC protocol stream on the stdio transport). Each line is prefixed with
`[mikrotik-mcp]` and the level; color is added automatically when stderr is a
TTY. Set `MIKROTIK_LOG_LEVEL=debug` to see every command the server issues.

## Authentication: key file vs. password

The SSH client accepts a private key, a password, or both. Resolution:

1. **Inline private key** (`MIKROTIK_PRIVATE_KEY` / `--private-key`) — a PEM
   string. Takes precedence over a key file.
2. **Key file** (`MIKROTIK_KEY_FILENAME` / `--key-filename`) — a path read from
   disk at connect time. If the file can't be read, the connection fails with a
   logged error.
3. **Key passphrase** (`MIKROTIK_KEY_PASSPHRASE` / `--key-passphrase`) — supply
   this when the private key (file or inline) is **encrypted**. It is ignored
   when no key is configured.
4. **Password** (`MIKROTIK_PASSWORD` / `--password`) — added to the SSH config
   when present. The key is tried first; a password can be supplied as a fallback.

`auth-check` prints which mode it used (`Auth mode: SSH key` or `password`) so
you can confirm at a glance.

**Recommendation:** prefer key-based auth, especially in containers, where a
plaintext password in the environment is visible via `docker inspect`. The
server emits a security warning when it detects a plaintext password while
running inside a container. See [Security](./security.md).

## Example

A fully explicit invocation over the streamable-HTTP transport, bound to
localhost with key auth:

```bash
mikrotik-mcp serve \
  --host 192.168.88.1 \
  --username automation \
  --key-filename ~/.ssh/mikrotik_ed25519 \
  --transport streamable-http \
  --mcp-host 127.0.0.1 \
  --mcp-port 8000
```

The same thing via environment variables:

```bash
export MIKROTIK_HOST=192.168.88.1
export MIKROTIK_USERNAME=automation
export MIKROTIK_KEY_FILENAME=~/.ssh/mikrotik_ed25519
export MIKROTIK_MCP__TRANSPORT=streamable-http
export MIKROTIK_MCP__HOST=127.0.0.1
export MIKROTIK_MCP__PORT=8000
mikrotik-mcp serve
```
