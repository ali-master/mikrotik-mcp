/**
 * "What's New" — a creative release-notes modal that checks GitHub for a newer
 * version and presents the changelog in a center-stage floating card with glow,
 * particle constellation, and shimmer effects.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { api } from "./api";
import { Button } from "./geist";

// ── Types ────────────────────────────────────────────────────────────────────

interface ReleaseInfo {
  version: string;
  name: string;
  body: string;
  publishedAt: string;
  url: string;
  isNewer: boolean;
  currentVersion: string;
}

// ── localStorage helpers ─────────────────────────────────────────────────────

const LS_KEY = "mt-whats-new-dismissed";

function isDismissed(version: string): boolean {
  try {
    return localStorage.getItem(LS_KEY) === version;
  } catch {
    return false;
  }
}

function dismiss(version: string): void {
  try {
    localStorage.setItem(LS_KEY, version);
  } catch {
    /* storage unavailable */
  }
}

// ── Lightweight markdown → HTML ──────────────────────────────────────────────

function renderMarkdown(md: string): string {
  // 1. Escape HTML entities
  let html = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // 2. Fenced code blocks — extract before inline processing
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
    return `%%CB${codeBlocks.length - 1}%%`;
  });

  // 3. Inline code — protect from further transforms
  const inlines: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    inlines.push(`<code>${code}</code>`);
    return `%%IC${inlines.length - 1}%%`;
  });

  // 4. Images: ![alt](url)
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" style="max-width:100%;border-radius:6px;margin:6px 0"/>',
  );

  // 5. Links: [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  // 6. Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  // 7. Strikethrough: ~~text~~
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // 8. Headings
  html = html.replace(/^#### (.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

  // 9. Blockquotes (multi-line support)
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, "\n");

  // 10. Horizontal rules
  html = html.replace(/^---$/gm, "<hr/>");

  // 11. Tables: | col | col | ... with optional alignment row
  html = html.replace(/((?:^\|.+\|\n?)+)/gm, (block) => {
    const rows = block.trim().split("\n").filter(Boolean);
    if (rows.length < 2) return block;
    const parseRow = (r: string): string[] =>
      r
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
    const headerCells = parseRow(rows[0]);
    // Check if second row is alignment (all dashes/colons)
    const isAlign = /^\|[\s:*-]+\|$/.test(rows[1].replace(/[^|:*-\s]/g, ""));
    const alignRow = isAlign ? parseRow(rows[1]) : null;
    const aligns = alignRow
      ? alignRow.map((c) => {
          if (c.startsWith(":") && c.endsWith(":")) return "center";
          if (c.endsWith(":")) return "right";
          return "left";
        })
      : headerCells.map(() => "left" as const);
    const bodyRows = rows.slice(isAlign ? 2 : 1);
    let t = '<div class="wn-table-wrap"><table><thead><tr>';
    for (let i = 0; i < headerCells.length; i++)
      t += `<th style="text-align:${aligns[i]}">${headerCells[i]}</th>`;
    t += "</tr></thead><tbody>";
    for (const row of bodyRows) {
      const cells = parseRow(row);
      t += "<tr>";
      for (let i = 0; i < headerCells.length; i++)
        t += `<td style="text-align:${aligns[i]}">${cells[i] ?? ""}</td>`;
      t += "</tr>";
    }
    t += "</tbody></table></div>";
    return t;
  });

  // 12. Ordered lists: 1. item
  html = html.replace(/^(\d+)\. (.+)$/gm, "<oli>$2</oli>");
  html = html.replace(
    /((?:<oli>.*<\/oli>\n?)+)/g,
    (m) => `<ol>${m.replace(/<\/?oli>/g, (tag) => tag.replace("oli", "li"))}</ol>`,
  );

  // 13. Unordered lists: - item or * item
  html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // 14. Task lists: - [x] or - [ ]
  html = html.replace(
    /<li>\[x\] (.+?)<\/li>/g,
    '<li class="wn-task done"><span class="wn-check">&#10003;</span> $1</li>',
  );
  html = html.replace(
    /<li>\[ \] (.+?)<\/li>/g,
    '<li class="wn-task"><span class="wn-check">&#9744;</span> $1</li>',
  );

  // 15. Paragraphs for remaining lines
  const lines = html.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      result.push("");
    } else if (/^<(h[2-5]|ul|ol|li|pre|blockquote|hr|div|table|img)/.test(t)) {
      result.push(t);
    } else {
      result.push(`<p>${t}</p>`);
    }
  }
  html = result.join("\n");

  // 16. Restore code blocks and inline code
  html = html.replace(/%%CB(\d+)%%/g, (_, i) => codeBlocks[Number(i)]);
  html = html.replace(/%%IC(\d+)%%/g, (_, i) => inlines[Number(i)]);

  return html;
}

// ── Particle position generator ──────────────────────────────────────────────

function particleStyle(i: number): CSSProperties {
  const x = (i * 37 + 13) % 100;
  const y = (i * 53 + 7) % 100;
  const delay = (i * 0.3) % 6;
  const size = 2 + (i % 3);
  return {
    left: `${x}%`,
    top: `${y}%`,
    width: size,
    height: size,
    animationDelay: `${delay}s`,
    animationDuration: `${4 + (i % 4)}s`,
  };
}

const PARTICLE_COUNT = 20;
const PARTICLES = Array.from({ length: PARTICLE_COUNT }, (_, i) => i);

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWhatsNew(currentVersion: string | undefined): {
  release: ReleaseInfo | null;
  showModal: boolean;
  showIndicator: boolean;
  openModal: () => void;
  dismissRelease: () => void;
} {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [showModal, setShowModal] = useState(false);
  const fetched = useRef(false);

  useEffect(() => {
    if (!currentVersion || fetched.current) return;
    fetched.current = true;

    api<ReleaseInfo>("/api/releases/latest")
      .then((r) => {
        // Always store the release so the user can view current release notes
        setRelease(r);
        // Auto-show modal only for newer versions that haven't been dismissed
        if (r.isNewer && !isDismissed(r.version)) {
          setTimeout(() => setShowModal(true), 1200);
        }
      })
      .catch(() => {
        /* silent — update check is best-effort */
      });
  }, [currentVersion]);

  const dismissRelease = useCallback(() => {
    if (release?.isNewer) dismiss(release.version);
    setShowModal(false);
  }, [release]);

  const openModal = useCallback(() => setShowModal(true), []);

  return {
    release,
    showModal,
    showIndicator: release !== null && release.isNewer,
    openModal,
    dismissRelease,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function WhatsNewModal({
  release,
  onDismiss,
}: {
  release: ReleaseInfo;
  onDismiss: () => void;
}): ReactNode {
  const [closing, setClosing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onDismiss();
    }, 300);
  }, [onDismiss]);

  // Escape key
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [handleClose]);

  const date = new Date(release.publishedAt);
  const formatted = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      className={`wn-overlay${closing ? " is-closing" : ""}`}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="wn-card" ref={cardRef}>
        {/* Floating constellation particles */}
        <div className="wn-particles" aria-hidden="true">
          {PARTICLES.map((i) => (
            <span key={i} className="wn-particle" style={particleStyle(i)} />
          ))}
        </div>

        {/* Glow burst behind the hero */}
        <div className="wn-glow" aria-hidden="true" />

        {/* Close button */}
        <button className="wn-close" onClick={handleClose} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Hero */}
        <div className="wn-hero">
          <span className="wn-badge">{release.isNewer ? "NEW RELEASE" : "RELEASE NOTES"}</span>
          <h2 className="wn-version">v{release.version}</h2>
          <p className="wn-date">
            Released {formatted}
            {release.isNewer && <> &middot; you&rsquo;re on v{release.currentVersion}</>}
          </p>
        </div>

        {/* Timeline divider */}
        <div className="wn-divider">
          <span className="wn-dot" />
        </div>

        {/* Release body */}
        <div
          className="wn-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(release.body) }}
        />

        {/* Footer */}
        <div className="wn-footer">
          <a href={release.url} target="_blank" rel="noopener noreferrer" className="wn-link">
            View on GitHub
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M1 12L12 1M12 1H4M12 1v8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
          <Button type="default" size="sm" onClick={handleClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}
