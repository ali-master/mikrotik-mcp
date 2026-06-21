# syntax=docker/dockerfile:1
# Bun-native MikroTik MCP server.
#
# Build:  docker build -t mikrotik-mcp .
# Run (stdio is awkward in Docker — use the HTTP transport):
#   docker run --rm -p 8000:8000 \
#     -e MIKROTIK_HOST=192.168.88.1 \
#     -e MIKROTIK_USERNAME=admin \
#     -e MIKROTIK_PASSWORD=•••• \
#     -e MIKROTIK_MCP__TRANSPORT=streamable-http \
#     mikrotik-mcp
#
# SECURITY: env vars are visible via `docker inspect`. In shared/production
# environments pass credentials via Docker secrets or a mounted key file
# (MIKROTIK_KEY_FILENAME) instead of a plaintext password.
#
# Public exposure (e.g. a ChatGPT Apps connector)? Add MIKROTIK_READ_ONLY=true so
# only inspection tools are reachable until auth is in place, and put HTTPS in
# front (e.g. Cloudflare Tunnel). See docs/docker.md#deploying-to-chatgpt-apps.

FROM oven/bun:1.3-alpine AS build
WORKDIR /app
# git is a safety net for toolchain steps that probe for it. `--ignore-scripts`
# skips the dev-only root `prepare` (vp config / git-hook setup), which has no
# place in an image build and needs a git checkout that isn't present here.
RUN apk add --no-cache git
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build

# Production-only dependencies for the runtime image. The CLI bundle keeps its
# runtime deps external (e.g. ssh2, @modelcontextprotocol/sdk + ext-apps), so we
# ship a pruned node_modules rather than relying on Bun's runtime auto-install
# (which needs network access and can't resolve every deep subpath).
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    MIKROTIK_MCP__TRANSPORT=streamable-http \
    MIKROTIK_MCP__HOST=0.0.0.0 \
    MIKROTIK_MCP__PORT=8000
# Ship the bundled CLI, its production deps, and the data dirs it reads at runtime.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prompts ./prompts
COPY --from=build /app/schemas ./schemas
COPY --from=build /app/package.json ./package.json

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["bun", "dist/cli.js"]
CMD ["serve"]
