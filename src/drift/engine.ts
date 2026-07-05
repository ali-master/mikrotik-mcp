/**
 * Pure drift-analysis engine — no device I/O, no SQLite, no Bun deps.
 *
 * Takes the result of a `diffLines()` call between a golden-baseline export and
 * a live export, breaks the diff into per-RouterOS-section summaries, computes
 * an overall drift severity score, and best-effort-attributes changes to users
 * via system-log correlation.
 */
import type { DiffResult, DiffOp } from "../core/diff";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DriftSection {
  /** RouterOS section path (e.g. "/ip firewall filter"). */
  path: string;
  added: number;
  removed: number;
  /** The relevant unified-diff hunks for this section. */
  hunks: string;
}

export interface ChangeAttribution {
  /** Best-guess matching section. */
  section: string;
  timestamp?: string;
  user?: string;
  action?: string;
  logLine: string;
}

export interface DriftReport {
  device: string;
  baselineId: string;
  baselineTs: number;
  capturedAt: number;
  identical: boolean;
  /** 0–100 severity score. */
  score: number;
  summary: { added: number; removed: number; unchanged: number };
  sections: DriftSection[];
  attributions: ChangeAttribution[];
  /** Full unified diff text. */
  unified: string;
}

// ── Section parsing ─────────────────────────────────────────────────────────

/** Lines starting with `/` begin a new RouterOS section. */
const SECTION_RE = /^\/\S+/;

// ── Drift analysis ──────────────────────────────────────────────────────────

/**
 * Walk the diff ops and group add/del counts by the RouterOS section they
 * fall under. The section is tracked by looking at "eq" lines that match
 * the section header pattern.
 */
function sectionDrift(ops: DiffOp[]): Map<string, { added: number; removed: number }> {
  const map = new Map<string, { added: number; removed: number }>();
  let current = "(preamble)";

  for (const op of ops) {
    if (op.type === "eq" && SECTION_RE.test(op.text)) {
      current = op.text.trim();
    } else if (op.type === "add" && SECTION_RE.test(op.text)) {
      current = op.text.trim();
    } else if (op.type === "del" && SECTION_RE.test(op.text)) {
      current = op.text.trim();
    }

    if (op.type === "add" || op.type === "del") {
      let entry = map.get(current);
      if (!entry) {
        entry = { added: 0, removed: 0 };
        map.set(current, entry);
      }
      if (op.type === "add") entry.added++;
      else entry.removed++;
    }
  }
  return map;
}

/**
 * Extract the unified-diff hunks that belong to a given section path from the
 * full unified diff text. Hunks are identified by scanning for `@@` headers
 * and matching the context lines against the section path.
 */
function extractSectionHunks(unified: string, sectionPath: string): string {
  if (!unified) return "";
  const lines = unified.split("\n");
  const hunks: string[] = [];
  let inRelevant = false;
  let currentHunk: string[] = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Flush previous hunk if relevant
      if (inRelevant && currentHunk.length > 0) {
        hunks.push(currentHunk.join("\n"));
      }
      currentHunk = [line];
      inRelevant = false;
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    } else {
      currentHunk.push(line);
      // Check if any line in this hunk references our section
      const content =
        line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") ? line.slice(1) : line;
      if (content.trim() === sectionPath || content.trim().startsWith(`${sectionPath} `)) {
        inRelevant = true;
      }
    }
  }
  if (inRelevant && currentHunk.length > 0) {
    hunks.push(currentHunk.join("\n"));
  }
  return hunks.join("\n");
}

/** Critical RouterOS sections that get a higher drift-score weight. */
const CRITICAL_SECTIONS: Record<string, number> = {
  firewall: 3,
  user: 3,
  certificate: 2,
  routing: 2,
  bgp: 2,
  ospf: 2,
  ipsec: 2,
  radius: 2,
  ppp: 2,
};

/** Compute a 0–100 drift severity score from the per-section changes. */
export function driftScore(sections: DriftSection[]): number {
  let weighted = 0;
  for (const s of sections) {
    const total = s.added + s.removed;
    let weight = 1;
    for (const [keyword, w] of Object.entries(CRITICAL_SECTIONS)) {
      if (s.path.toLowerCase().includes(keyword)) {
        weight = Math.max(weight, w);
      }
    }
    weighted += total * weight;
  }
  return Math.min(100, Math.round(weighted * 2));
}

/**
 * Produce a full drift report from a diff result and context metadata.
 */
export function analyzeDrift(
  diff: DiffResult,
  device: string,
  baselineId: string,
  baselineTs: number,
): DriftReport {
  const capturedAt = Date.now();
  const sectionMap = sectionDrift(diff.ops);

  const sections: DriftSection[] = [];
  for (const [path, counts] of sectionMap) {
    if (path === "(preamble)" && counts.added === 0 && counts.removed === 0) continue;
    sections.push({
      path,
      added: counts.added,
      removed: counts.removed,
      hunks: extractSectionHunks(diff.unified, path),
    });
  }
  // Sort by total changes descending
  sections.sort((a, b) => b.added + b.removed - (a.added + a.removed));

  return {
    device,
    baselineId,
    baselineTs,
    capturedAt,
    identical: !diff.summary.changed,
    score: diff.summary.changed ? driftScore(sections) : 0,
    summary: {
      added: diff.summary.added,
      removed: diff.summary.removed,
      unchanged: diff.summary.unchanged,
    },
    sections,
    attributions: [], // filled by attributeChanges()
    unified: diff.unified,
  };
}

// ── Change attribution ──────────────────────────────────────────────────────

/**
 * Parse RouterOS log output and attempt to match entries to drift sections.
 *
 * RouterOS log lines have the format:
 *   `<time> <topics> <message>`
 * e.g.:
 *   `jul/04/2025 10:30:05 system,info config changed by admin`
 *   `jul/04/2025 10:31:00 system,info,account user admin logged in from 192.168.1.2`
 */
export function attributeChanges(sections: DriftSection[], logText: string): ChangeAttribution[] {
  if (!logText.trim()) return [];

  const attributions: ChangeAttribution[] = [];
  const logLines = logText.split("\n").filter((l) => l.trim());

  // Keywords that indicate config-mutation log entries
  const CONFIG_KEYWORDS =
    /\b(changed|added|removed|set|moved|disabled|enabled|updated|created|deleted)\b/i;
  // Extract user from "by <username>" pattern
  const BY_USER = /\bby\s+(\S+)/i;
  // Extract timestamp from start of log line
  const LOG_TS = /^(\w{3}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/;

  for (const line of logLines) {
    if (!CONFIG_KEYWORDS.test(line)) continue;

    const tsMatch = LOG_TS.exec(line);
    const userMatch = BY_USER.exec(line);
    const actionMatch = CONFIG_KEYWORDS.exec(line);

    // Match this log entry to the most relevant section
    let bestSection = sections[0]?.path ?? "(unknown)";
    const lowerLine = line.toLowerCase();
    for (const s of sections) {
      // Extract the leaf segment of the section path for matching
      const pathParts = s.path.replace(/^\//, "").split(/[\s/]+/);
      if (pathParts.some((part) => part.length > 2 && lowerLine.includes(part.toLowerCase()))) {
        bestSection = s.path;
        break;
      }
    }

    attributions.push({
      section: bestSection,
      timestamp: tsMatch?.[1],
      user: userMatch?.[1],
      action: actionMatch?.[1],
      logLine: line.trim(),
    });
  }

  return attributions;
}

// ── Report formatting ───────────────────────────────────────────────────────

/** Render a drift report as human-readable text for the MCP tool output. */
export function renderDriftReport(report: DriftReport, maxLines: number): string {
  const lines: string[] = [];

  // Header
  const status = report.identical ? "IN SYNC" : "DRIFTED";
  lines.push(`CONFIG DRIFT REPORT — ${report.device} — ${status}`);
  lines.push(`Baseline: ${report.baselineId} (${new Date(report.baselineTs).toISOString()})`);
  lines.push(`Checked:  ${new Date(report.capturedAt).toISOString()}`);

  if (report.identical) {
    lines.push("\nNo differences — the live configuration matches the golden baseline.");
    return lines.join("\n");
  }

  lines.push(`Score:    ${report.score}/100`);
  lines.push(
    `Summary:  +${report.summary.added} added, -${report.summary.removed} removed, ${report.summary.unchanged} unchanged`,
  );

  // Section breakdown
  if (report.sections.length > 0) {
    lines.push("\n── Sections with drift ──");
    for (const s of report.sections) {
      const bar = "█".repeat(Math.min(20, s.added + s.removed));
      lines.push(`  ${s.path}  +${s.added} -${s.removed}  ${bar}`);
    }
  }

  // Change attribution
  if (report.attributions.length > 0) {
    lines.push("\n── Change attribution (from system logs) ──");
    for (const a of report.attributions) {
      const who = a.user ? ` by ${a.user}` : "";
      const when = a.timestamp ? ` at ${a.timestamp}` : "";
      lines.push(`  [${a.action ?? "?"}]${who}${when} → ${a.section}`);
      lines.push(`    ${a.logLine}`);
    }
  }

  // Unified diff (truncated)
  if (report.unified) {
    lines.push("\n── Unified diff ──");
    const diffLines = report.unified.split("\n");
    const usedLines = lines.length;
    const remaining = Math.max(20, maxLines - usedLines);
    if (diffLines.length > remaining) {
      lines.push(...diffLines.slice(0, remaining));
      lines.push(`\n… diff truncated at ${remaining} lines (${diffLines.length} total)`);
    } else {
      lines.push(...diffLines);
    }
  }

  return lines.join("\n");
}
