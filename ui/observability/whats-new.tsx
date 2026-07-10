/**
 * "What's New" — a creative release-notes modal that checks GitHub for a newer
 * version and presents the changelog in a center-stage floating card with glow,
 * particle constellation, and shimmer effects.
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { api } from "./api";
import { Button } from "./geist";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
const LS_SEEN_KEY = "mt-whats-new-seen-version";

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

/** Returns true when the running version changed since the last dashboard visit. */
function checkVersionChanged(version: string): boolean {
  try {
    const prev = localStorage.getItem(LS_SEEN_KEY);
    localStorage.setItem(LS_SEEN_KEY, version);
    return prev !== null && prev !== version;
  } catch {
    return false;
  }
}

// ── Lightweight markdown → HTML ──────────────────────────────────────────────

function renderMarkdown(md: string): string {
  // 0. Normalize line endings (GitHub API may return \r\n)
  let html = md.replace(/\r\n?/g, "\n");

  // 1. Escape HTML entities
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

  // 5b. Auto-link bare URLs not already inside an href or src attribute
  html = html.replace(
    /(?<!=["'])(https?:\/\/[^\s<>")\]]+)/g,
    '<a href="$1" target="_blank" rel="noopener">$1</a>',
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
    const isAlign = /^(\|[\s:*-]+)+\|$/.test(rows[1].replace(/[^|:*-\s]/g, ""));
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
  html = html.replace(/<\/oli>\n\n+<oli>/g, "</oli>\n<oli>");
  html = html.replace(
    /((?:<oli>.*<\/oli>\n?)+)/g,
    (m) => `<ol>${m.trimEnd().replace(/<\/?oli>/g, (tag) => tag.replace("oli", "li"))}</ol>`,
  );

  // 13. Unordered lists: - item or * item
  html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/<\/li>\n\n+<li>/g, "</li>\n<li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, (m) => `<ul>${m.trimEnd()}</ul>`);

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
    } else if (/^<\/?(h[2-5]|ul|ol|li|pre|blockquote|hr|div|table|img)/.test(t)) {
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

// ── Rendered-markdown styling ────────────────────────────────────────────────
// The release body is injected HTML (see renderMarkdown), so its descendant tags
// are styled via arbitrary variants on the container rather than a stylesheet.
const MARKDOWN =
  "text-[13px] leading-[1.7] text-muted-foreground " +
  "[&_h2]:mt-[18px] [&_h2]:mb-1.5 [&_h2]:text-[17px] [&_h2]:font-bold [&_h2]:text-foreground " +
  "[&_h3]:mt-[18px] [&_h3]:mb-1.5 [&_h3]:text-[15px] [&_h3]:font-bold [&_h3]:text-foreground " +
  "[&_h4]:mt-[18px] [&_h4]:mb-1.5 [&_h4]:text-[14px] [&_h4]:font-bold [&_h4]:text-foreground " +
  "[&_h5]:mt-[18px] [&_h5]:mb-1.5 [&_h5]:text-[14px] [&_h5]:font-bold [&_h5]:text-foreground " +
  "[&_p]:my-[5px] [&_ul]:my-[5px] [&_ul]:pl-[18px] [&_ol]:my-[5px] [&_ol]:pl-[22px] " +
  "[&_li]:my-[3px] [&_li]:marker:text-brand " +
  "[&_code]:rounded [&_code]:border [&_code]:border-border [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-brand " +
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-background [&_pre]:p-3 " +
  "[&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-muted-foreground " +
  "[&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 " +
  "[&_strong]:font-semibold [&_strong]:text-foreground " +
  "[&_blockquote]:my-2 [&_blockquote]:border-l-[3px] [&_blockquote]:border-brand/40 [&_blockquote]:px-3.5 [&_blockquote]:py-1.5 [&_blockquote]:italic " +
  "[&_hr]:my-3.5 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border " +
  "[&_del]:text-muted-foreground [&_del]:opacity-60 " +
  "[&_table]:w-full [&_table]:border-collapse [&_table]:font-mono [&_table]:text-xs " +
  "[&_th]:border-b [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-[7px] [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:tracking-wide [&_th]:text-foreground [&_th]:uppercase " +
  "[&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-[7px] [&_td]:text-muted-foreground " +
  "[&_.wn-table-wrap]:my-2.5 [&_.wn-table-wrap]:overflow-x-auto [&_.wn-table-wrap]:rounded-md [&_.wn-table-wrap]:border [&_.wn-table-wrap]:border-border " +
  "[&_.wn-task]:-ml-[18px] [&_.wn-task]:list-none [&_.wn-check]:inline-block [&_.wn-check]:w-4 [&_.wn-task.done_.wn-check]:text-success";

// ── Hook ─────────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 10 * 60 * 1000; // 10 minutes

export function useWhatsNew(currentVersion: string | undefined): {
  release: ReleaseInfo | null;
  showModal: boolean;
  showIndicator: boolean;
  openModal: () => void;
  dismissRelease: () => void;
} {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!currentVersion) return;

    // Detect if the running server version changed since the last visit (user updated)
    const justUpdated = checkVersionChanged(currentVersion);
    let prevFetchedVersion: string | null = null;

    const fetchRelease = (): void => {
      api<ReleaseInfo>("/api/releases/latest")
        .then((r) => {
          setRelease(r);

          const isFirst = prevFetchedVersion === null;
          const newRemoteVersion = prevFetchedVersion !== null && r.version !== prevFetchedVersion;
          prevFetchedVersion = r.version;

          // Auto-show when user just updated the project (show current changelog)
          if (isFirst && justUpdated) {
            setTimeout(() => setShowModal(true), 1200);
            return;
          }
          // Auto-show when a newer version is discovered (on load or via poll)
          if (r.isNewer && !isDismissed(r.version) && (isFirst || newRemoteVersion)) {
            setTimeout(() => setShowModal(true), isFirst ? 1200 : 0);
          }
        })
        .catch(() => {
          /* silent — update check is best-effort */
        });
    };

    fetchRelease();
    const id = setInterval(fetchRelease, POLL_INTERVAL);
    return () => clearInterval(id);
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
  const date = new Date(release.publishedAt);
  const formatted = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Mounted means open; Radix gives us Escape, backdrop click, focus trap and a
  // close button for free. Any dismissal unmounts us via the parent's onDismiss.
  const bodyHtml = { __html: renderMarkdown(release.body) };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onDismiss();
      }}
    >
      <DialogContent className="max-h-[calc(100vh-80px)] gap-0 overflow-y-auto p-0 sm:max-w-[520px]">
        <DialogHeader className="items-center gap-4 px-8 pt-10 pb-6 text-center">
          <span className="inline-block rounded-full border border-brand/30 bg-brand/10 px-3.5 py-1 font-mono text-[10px] font-bold tracking-[0.2em] text-brand uppercase">
            {release.isNewer ? "NEW RELEASE" : "RELEASE NOTES"}
          </span>
          <DialogTitle className="text-[44px] leading-none font-extrabold tracking-tight text-brand">
            v{release.version}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs text-muted-foreground">
            Released {formatted}
            {release.isNewer && <> &middot; you&rsquo;re on v{release.currentVersion}</>}
          </DialogDescription>
        </DialogHeader>

        {/* eslint-disable-next-line react/no-danger -- markdown is escaped in renderMarkdown */}
        <div className={cn("px-8 py-5", MARKDOWN)} dangerouslySetInnerHTML={bodyHtml} />

        <DialogFooter className="flex-row items-center justify-between border-t border-border px-8 pt-3.5 pb-6">
          <a
            href={release.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            View on GitHub
            <ExternalLink className="size-3.5" />
          </a>
          <Button type="default" size="sm" onClick={onDismiss}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
