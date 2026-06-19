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

FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    MIKROTIK_MCP__TRANSPORT=streamable-http \
    MIKROTIK_MCP__HOST=0.0.0.0 \
    MIKROTIK_MCP__PORT=8000
# Ship the bundled CLI plus the data dirs it reads at runtime.
COPY --from=build /app/dist ./dist
COPY --from=build /app/prompts ./prompts
COPY --from=build /app/schemas ./schemas
COPY --from=build /app/package.json ./package.json

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["bun", "dist/cli.js"]
CMD ["serve"]
