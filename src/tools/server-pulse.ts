/**
 * Server Pulse — the MCP server's self-awareness heartbeat.
 *
 * A single always-available READ tool that reports the server's running
 * version, whether a newer release exists, full GitHub release notes,
 * freshness assessment, upgrade commands, and server vitals. No RouterOS
 * device is contacted — this is pure server-side metadata.
 */
import { z } from "zod";
import type { ToolModule } from "../core/registry";
import { READ, defineTool } from "../core/registry";
import { assessFreshness, checkForUpdate } from "../core/update-check";
import type { Freshness } from "../core/update-check";
import { SERVER_TITLE, VERSION, WEBSITE_URL } from "../version";

const UPGRADE_COMMANDS: Record<string, string> = {
  bunx: "bunx @usex/mikrotik-mcp@latest",
  npx: "npx @usex/mikrotik-mcp@latest",
  "bun global": "bun add -g @usex/mikrotik-mcp@latest",
  "npm global": "npm install -g @usex/mikrotik-mcp@latest",
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function freshnessLabel(f: Freshness): string {
  const labels: Record<Freshness, string> = {
    fresh: "UP TO DATE",
    aging: "SLIGHTLY BEHIND",
    stale: "UPDATE RECOMMENDED",
    ancient: "CRITICAL UPDATE NEEDED",
  };
  return labels[f];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export const serverPulseTools: ToolModule = [
  defineTool({
    name: "check_server_pulse",
    title: "Server Pulse & Update Check",
    noDevice: true,
    annotations: READ,
    description:
      "Check the MCP server's own heartbeat: running version, whether a newer release " +
      "is available, release notes for the latest version, upgrade commands, and server " +
      "vitals (tool count, uptime). This is server self-awareness — no RouterOS device " +
      "is contacted. Call this when the user asks about the MCP server version, updates, " +
      "what's new, or 'is my server up to date'. Returns rich release notes from GitHub " +
      "so you can summarize what changed.",
    inputSchema: {
      include_release_notes: z
        .boolean()
        .optional()
        .describe(
          "Include the full GitHub release notes markdown (default true). " +
            "Set false for a compact version-only check.",
        ),
    },
    async handler(args) {
      const includeNotes = args.include_release_notes !== false;
      const result = await checkForUpdate();
      const uptime = Math.floor(process.uptime());
      const sections: string[] = [];

      // ── Section 1: Identity ──────────────────────────────────────────────
      const sep = "\u2500".repeat(50);
      sections.push(
        `SERVER PULSE \u2014 ${SERVER_TITLE} v${VERSION}`,
        sep,
        "Package:    @usex/mikrotik-mcp",
        `Version:    ${VERSION}`,
        `Uptime:     ${formatUptime(uptime)}`,
        `Website:    ${WEBSITE_URL}`,
      );

      // ── Section 2: Update status ─────────────────────────────────────────
      if (result.release) {
        const freshness = assessFreshness(VERSION, result.release.version);
        const label = freshnessLabel(freshness);
        const age = timeAgo(result.release.publishedAt);

        sections.push(
          "",
          `UPDATE STATUS: ${label}`,
          sep,
          `Current:    v${VERSION}`,
          `Latest:     v${result.release.version} (${result.release.name})`,
          `Published:  ${age}`,
          `Freshness:  ${freshness.toUpperCase()}`,
        );

        if (result.release.isNewer) {
          sections.push("", ">>> A newer version is available! <<<");
        } else {
          sections.push("", "You are running the latest version.");
        }

        // ── Section 3: Upgrade commands (only if newer) ────────────────────
        if (result.release.isNewer) {
          sections.push("", "UPGRADE", sep);
          for (const [method, cmd] of Object.entries(UPGRADE_COMMANDS)) {
            sections.push(`  ${method.padEnd(12)} ${cmd}`);
          }
          sections.push("", `Release:    ${result.release.url}`);
        }

        // ── Section 4: Release notes ───────────────────────────────────────
        if (includeNotes && result.release.body) {
          const notesHeader = result.release.isNewer
            ? `WHAT'S NEW IN v${result.release.version}`
            : `RELEASE NOTES — v${result.release.version}`;
          sections.push("", notesHeader, sep, result.release.body);
        }
      } else {
        sections.push(
          "",
          "UPDATE STATUS: UNKNOWN",
          sep,
          `Could not check for updates${result.error ? `: ${result.error}` : "."}`,
          `Current version: v${VERSION}`,
          result.fromCache
            ? "(showing cached data)"
            : "(no cached data available \u2014 check network connectivity)",
        );
      }

      return sections.join("\n");
    },
  }),
];
