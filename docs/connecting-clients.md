# Connecting clients

The server registers as `mcp-mikrotik` and advertises **229 tools** and
**5 prompts**. How you connect depends on the transport.

## Claude Desktop (stdio)

Add an entry to your `claude_desktop_config.json`. On macOS this lives at
`~/Library/Application Support/Claude/claude_desktop_config.json`; on Windows at
`%APPDATA%\Claude\claude_desktop_config.json`.

```json
{
  "mcpServers": {
    "mikrotik": {
      "command": "mikrotik-mcp",
      "env": {
        "MIKROTIK_HOST": "192.168.88.1",
        "MIKROTIK_USERNAME": "admin",
        "MIKROTIK_PASSWORD": "your-password"
      }
    }
  }
}
```

The `command` is the globally installed binary (`bun add -g @usex/mikrotik-mcp`).
With no arguments it starts in stdio mode, which is exactly what Claude Desktop
expects. Restart Claude Desktop after editing the config.

### Key-file authentication

Swap the password for a key path:

```json
{
  "mcpServers": {
    "mikrotik": {
      "command": "mikrotik-mcp",
      "env": {
        "MIKROTIK_HOST": "192.168.88.1",
        "MIKROTIK_USERNAME": "automation",
        "MIKROTIK_KEY_FILENAME": "/Users/you/.ssh/mikrotik_ed25519"
      }
    }
  }
}
```

### Running from source

If you didn't install globally, point `command` at `bun` and pass the entry
file:

```json
{
  "mcpServers": {
    "mikrotik": {
      "command": "bun",
      "args": ["run", "/path/to/mikrotik-mcp/src/cli.ts", "serve"],
      "env": {
        "MIKROTIK_HOST": "192.168.88.1",
        "MIKROTIK_USERNAME": "admin",
        "MIKROTIK_PASSWORD": "your-password"
      }
    }
  }
}
```

## Generic stdio client

Any MCP client that launches a subprocess works the same way: invoke
`mikrotik-mcp` (or `bun run src/cli.ts serve`), supply credentials through the
environment, and speak JSON-RPC over stdin/stdout. Conceptually:

```jsonc
{
  "command": "mikrotik-mcp",
  "args": [],            // "serve" is implied
  "env": {
    "MIKROTIK_HOST": "192.168.88.1",
    "MIKROTIK_USERNAME": "admin",
    "MIKROTIK_PASSWORD": "your-password"
  }
}
```

## HTTP client (streamable-http / sse)

For remote or shared deployments, run the server over HTTP and point the client
at the `/mcp` endpoint.

Start the server:

```bash
MIKROTIK_HOST=192.168.88.1 \
MIKROTIK_USERNAME=admin \
MIKROTIK_PASSWORD='your-password' \
mikrotik-mcp serve --transport streamable-http --mcp-port 8000
```

Point the client at the URL:

```
http://your-host:8000/mcp
```

A client config for an HTTP-capable MCP client typically looks like:

```json
{
  "mcpServers": {
    "mikrotik": {
      "url": "http://your-host:8000/mcp"
    }
  }
}
```

Check liveness any time with `curl http://your-host:8000/health`.

> If you expose the HTTP transport beyond localhost, read the
> [DNS-rebinding protection](./transports.md#dns-rebinding-protection) section
> and set `--mcp-allowed-hosts` / `--mcp-allowed-origins` appropriately.

## Verifying the connection

If a client shows zero tools, first confirm the server itself can reach the
device:

```bash
mikrotik-mcp auth-check
```

Then confirm the catalog loads:

```bash
mikrotik-mcp tools        # should end with "229 tools across 24 modules"
```
