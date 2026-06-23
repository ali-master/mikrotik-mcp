/**
 * Pure helpers for turning a RouterOS `/export` dump into snapshot metadata.
 *
 * Kept free of any Bun/SQLite/device dependency so it is unit-tested directly,
 * and so the snapshot tool module can import it without dragging `bun:sqlite`
 * into the Node/Vitest import graph (see {@link ./store}).
 *
 * A RouterOS export begins with a comment header, e.g.:
 * ```
 * # 2024-01-15 10:30:05 by RouterOS 7.14.3
 * # software id = ABCD-1234
 * #
 * /interface bridge
 * add name=bridge1
 * ```
 * The first line carries a wall-clock timestamp that changes on every export
 * even when the configuration is byte-for-byte identical, so {@link
 * normalizeExport} strips it before hashing/diffing — otherwise two captures of
 * an unchanged device would always look different.
 */
import { createHash } from "node:crypto";

/** Matches the volatile `# <timestamp> by RouterOS <ver>` export header line. */
const TIMESTAMP_HEADER = /^#\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\b.*by RouterOS/i;

export interface ExportMeta {
  /** RouterOS version parsed from the export header, when present. */
  rosVersion?: string;
  /** The `YYYY-MM-DD HH:MM:SS` the device stamped on the export, when present. */
  exportedAt?: string;
}

/** Parse the RouterOS version and export timestamp out of the export header. */
export function parseExportMeta(body: string): ExportMeta {
  // The header is always within the first few lines; cap the scan cheaply.
  const head = body.slice(0, 600);
  const version = head.match(/by RouterOS ([^\s#]+)/i)?.[1];
  const exportedAt = head.match(/#\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)?.[1];
  return { rosVersion: version, exportedAt };
}

/**
 * Strip volatile, content-irrelevant lines (the timestamped export header) and
 * normalise line endings so identical configurations hash and diff identically.
 */
export function normalizeExport(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !TIMESTAMP_HEADER.test(line))
    .join("\n")
    .replace(/\n+$/, "");
}

/** Short, stable content fingerprint of a normalised export (for dedup/identity). */
export function contentSha(normalizedBody: string): string {
  return createHash("sha256").update(normalizedBody, "utf8").digest("hex").slice(0, 16);
}

/** Count non-trailing-blank lines in a body. */
export function countLines(body: string): number {
  const trimmed = body.replace(/\n+$/, "");
  return trimmed === "" ? 0 : trimmed.split("\n").length;
}
