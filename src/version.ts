/**
 * Single source of truth for the server version.
 *
 * Reads package.json with `readFileSync` at module-load time so the version
 * is always the on-disk value — even after the bundle has been built. The old
 * static `import … with { type: "json" }` got inlined by bunup, causing the
 * dashboard to show a stale version until the next rebuild.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "./paths";

interface PkgJson {
  version: string;
  name: string;
  description: string;
  homepage: string;
  logoIcon: string;
  license: string;
  author: string | { name: string };
  [k: string]: unknown;
}

const pkg: PkgJson = JSON.parse(
  readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8"),
) as PkgJson;

export const VERSION: string = pkg.version ?? "0.0.0";
export const WEBSITE_URL: string = pkg.homepage ?? "";
export const LOGO_URL: string = pkg.logoIcon ?? "";
export const SERVER_TITLE: string = "MikroTik MCP";
export const SERVER_DESCRIPTION: string = pkg.description ?? "";
export const SERVER_NAME = "mikrotik-mcp";

/** Raw parsed package.json — used by cli-logo for author/license metadata. */
export const PKG_META = pkg;
