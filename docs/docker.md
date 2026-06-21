# Docker

The server is a single Bun process, so a container image is small and simple. It
reaches the RouterOS device over the network via SSH, so the container only needs
outbound access to the device.

## Minimal image

```dockerfile
# Dockerfile
FROM oven/bun:1.3-alpine

WORKDIR /app

# Install production dependencies first for better layer caching.
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# Copy the rest of the source (prompts/ and schemas/ are needed at runtime).
COPY . .

# Run the CLI directly with Bun — no separate build step required.
ENTRYPOINT ["bun", "dist/cli.js"]
```

If you prefer running from a published bundle instead of source, run
`bun run build` in the image and keep `dist/`, `prompts/`, and `schemas/`.
For running straight from TypeScript source, change the entrypoint to
`["bun", "src/cli.ts"]`.

Build and run:

```bash
docker build -t mikrotik-mcp .

docker run --rm -it \
  -e MIKROTIK_HOST=192.168.88.1 \
  -e MIKROTIK_USERNAME=automation \
  mikrotik-mcp auth-check
```

## Passing configuration

Every [config setting](./configuration.md) is an environment variable, so wire
the container up with `-e` flags or an env file.

```bash
docker run --rm \
  -e MIKROTIK_HOST=192.168.88.1 \
  -e MIKROTIK_USERNAME=automation \
  -e MIKROTIK_KEY_FILENAME=/run/secrets/mikrotik_key \
  -e MIKROTIK_MCP__TRANSPORT=streamable-http \
  -e MIKROTIK_MCP__PORT=8000 \
  -e MIKROTIK_MCP__ALLOWED_HOSTS=mcp.example.com \
  -v /path/to/key:/run/secrets/mikrotik_key:ro \
  -p 8000:8000 \
  mikrotik-mcp serve
```

For the HTTP transports, publish the port (`-p 8000:8000`) and remember that
binding to `0.0.0.0` without an allow-list disables DNS-rebinding protection —
set `MIKROTIK_MCP__ALLOWED_HOSTS` to your domain. See
[Transports](./transports.md#dns-rebinding-protection).

The `/health` endpoint makes a clean container health check:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:8000/health || exit 1
```

## Security: don't put passwords in env

Environment variables are visible via `docker inspect`. When the server detects
it's running in a container (`/.dockerenv` or `container=docker`) with a plaintext
`MIKROTIK_PASSWORD`, it logs a security warning.

**Prefer a mounted SSH key or Docker/Compose secrets** over an inline password:

```yaml
# docker-compose.yml (excerpt)
services:
  mikrotik-mcp:
    image: mikrotik-mcp
    command: ["serve"]
    environment:
      MIKROTIK_HOST: 192.168.88.1
      MIKROTIK_USERNAME: automation
      MIKROTIK_KEY_FILENAME: /run/secrets/mikrotik_key
    secrets:
      - mikrotik_key
    ports:
      - "8000:8000"

secrets:
  mikrotik_key:
    file: ./secrets/mikrotik_ed25519
```

See [Security](./security.md) for the full threat model.

## Deploying to ChatGPT Apps

The server exposes its tools — and the interactive [MCP App views](./configuration.md)
(e.g. the device dashboard) — over the streamable-HTTP transport, which is what a
**ChatGPT Apps connector** talks to. ChatGPT requires three things the connector
checks for: a **public HTTPS `/mcp`**, **CORS** on that endpoint, and (for the
inline view) the App metadata the server already emits. CORS is built in; you
provide the public HTTPS.

> ⚠️ **This server SSHes into your router(s).** A public `/mcp` that anyone can
> reach can reconfigure your network. Until you put **authentication** in front
> of it, run it **read-only** (`--read-only` / `MIKROTIK_READ_ONLY=true`) so the
> connector can only _inspect_ — every write/destructive tool is withheld from
> the surface entirely. Keep writes for a trusted, authenticated path.

### 1. Run the server (read-only, CORS-ready)

```bash
docker run --rm \
  -e MIKROTIK_HOST=192.168.88.1 \
  -e MIKROTIK_USERNAME=automation \
  -e MIKROTIK_KEY_FILENAME=/run/secrets/mikrotik_key \
  -e MIKROTIK_MCP__TRANSPORT=streamable-http \
  -e MIKROTIK_MCP__HOST=0.0.0.0 -e MIKROTIK_MCP__PORT=8000 \
  -e MIKROTIK_MCP__ALLOWED_HOSTS=your-tunnel.example.com \
  -e MIKROTIK_READ_ONLY=true \
  -v /path/to/key:/run/secrets/mikrotik_key:ro \
  -p 8000:8000 \
  mikrotik-mcp serve
```

CORS defaults to the ChatGPT and Claude origins; set
`MIKROTIK_MCP__CORS_ORIGINS` to add others (or `*` to allow any). The startup
log shows `… app views (streamable-http) [READ-ONLY]`.

### 2. Put HTTPS in front (Cloudflare Tunnel)

ChatGPT needs an `https://` URL. A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
is the simplest zero-config option (no inbound ports, free TLS):

```bash
# Quick tunnel (ephemeral hostname) — great for first-time testing:
cloudflared tunnel --url http://localhost:8000
#  → https://random-words.trycloudflare.com   ⇒  endpoint: …/mcp

# Or a named tunnel bound to your own domain (stable, for keeps):
cloudflared tunnel create mikrotik-mcp
cloudflared tunnel route dns mikrotik-mcp mcp.example.com
cloudflared tunnel run --url http://localhost:8000 mikrotik-mcp
```

Set `MIKROTIK_MCP__ALLOWED_HOSTS` to the tunnel hostname so DNS-rebinding
protection stays on. `ngrok http 8000` works the same way for a quick test.

Run both together with Compose:

```yaml
# docker-compose.yml (excerpt)
services:
  mikrotik-mcp:
    image: mikrotik-mcp
    command: ["serve"]
    environment:
      MIKROTIK_HOST: 192.168.88.1
      MIKROTIK_USERNAME: automation
      MIKROTIK_KEY_FILENAME: /run/secrets/mikrotik_key
      MIKROTIK_MCP__TRANSPORT: streamable-http
      MIKROTIK_MCP__ALLOWED_HOSTS: mcp.example.com
      MIKROTIK_READ_ONLY: "true"
    secrets: [mikrotik_key]
  tunnel:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CF_TUNNEL_TOKEN}
    depends_on: [mikrotik-mcp]
```

### 3. Connect in ChatGPT

1. ChatGPT → **Settings** → enable **Developer mode**.
2. **Settings → Connectors → Create** → set the URL to
   `https://mcp.example.com/mcp`.
3. New chat → _"show my MikroTik dashboard"_. ChatGPT calls
   `show_system_dashboard` and renders the dashboard view inline. **Refresh the
   connector** after any server change. For a public listing, follow OpenAI's
   app submission/review flow.

### Notes

- **Verify the endpoint** before connecting:
  `curl -i -X OPTIONS https://mcp.example.com/mcp -H 'Origin: https://chatgpt.com'`
  should return `204` with `access-control-allow-origin: https://chatgpt.com`.
- **Claude** needs none of this — Claude Desktop connects over local stdio (or
  the same HTTP endpoint) without public hosting.
- The container must keep **outbound SSH** reach to the MikroTik device(s).
