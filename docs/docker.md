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
