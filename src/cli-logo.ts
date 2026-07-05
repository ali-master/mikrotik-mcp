/**
 * Branded CLI banner for the MikroTik MCP server.
 *
 * Renders a gradient ASCII logo to **stderr** (never stdout — the stdio MCP
 * transport needs a clean stdout for JSON-RPC). Only called once at startup
 * from the `serve` path, and only when the output is an interactive terminal.
 *
 * Uses figlet + gradient-string directly (oh-my-logo's top-level Ink import
 * crashes under React 19 because react-reconciler expects v18 internals).
 */
import figlet from "figlet";
import gradient from "gradient-string";
import { PKG_META, VERSION, WEBSITE_URL } from "./version";

/* ── Brand palette (matches observability dashboard accents) ─────────────── */
const BRAND = gradient(["#9d7bff", "#3291ff", "#2dd4bf"]);

/* ── ANSI helpers ────────────────────────────────────────────────────────── */
const ESC = "\x1B[";
const R = `${ESC}0m`;
const DIM = `${ESC}90m`;
const BOLD = `${ESC}1m`;
const ITALIC = `${ESC}3m`;
const rgb = (r: number, g: number, b: number) => `${ESC}38;2;${r};${g};${b}m`;

const CV = rgb(157, 123, 255); // violet
const CS = rgb(50, 145, 255); // sky
const CT = rgb(45, 212, 191); // teal
const CA = rgb(245, 166, 35); // amber

/**
 * Print the startup banner to stderr.
 */
export async function printBanner(): Promise<void> {
  if (!process.stderr.isTTY) return;

  try {
    const art = figlet.textSync("MikroTik MCP", { font: "Small" });
    const colored = BRAND.multiline(art);
    process.stderr.write(`${colored}\n`);

    // ── Info box ────────────────────────────────────────────────────────
    const author =
      typeof PKG_META.author === "object" ? PKG_META.author : { name: PKG_META.author };
    const site = WEBSITE_URL.replace(/^https?:\/\//, "");

    const w = 56; // inner width
    const hr = "─".repeat(w);
    const pad = (s: string, vis: number) => `${s}${" ".repeat(Math.max(0, w - 2 - vis))}`;

    // Row 1: version · transport · protocol
    const r1Label = `● v${VERSION}`;
    const r1Mid = "RouterOS over SSH";
    const r1End = "MCP Protocol";
    const r1Text = `  ${CV}●${R} ${BOLD}v${VERSION}${R}${DIM}  │  ${CS}${r1Mid}${R}${DIM}  │  ${CT}${r1End}${R}`;
    const r1Vis = r1Label.length + 2 + r1Mid.length + 4 + r1End.length + 4;

    // Row 2: author · license · website
    const r2Name = author.name ?? "Unknown";
    const r2License = PKG_META.license ?? "MIT";
    const r2Text = `  ${CA}${r2Name}${R}${DIM}  ·  ${ITALIC}${r2License}${R}${DIM}  ·  ${CS}${site}${R}`;
    const r2Vis = r2Name.length + 2 + r2License.length + 4 + site.length + 4;

    const box = [
      `${DIM}  ┌${hr}┐${R}`,
      `${DIM}  │${R}${pad(r1Text, r1Vis)}${DIM}│${R}`,
      `${DIM}  ├${hr}┤${R}`,
      `${DIM}  │${R}${pad(r2Text, r2Vis)}${DIM}│${R}`,
      `${DIM}  └${hr}┘${R}`,
    ].join("\n");

    process.stderr.write(`${box}\n\n`);
  } catch {
    // Silently fall back — the logo is cosmetic.
    process.stderr.write(`${DIM}MikroTik MCP v${VERSION}${R}\n`);
  }
}
