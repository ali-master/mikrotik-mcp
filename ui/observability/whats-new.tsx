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
import { renderMarkdown } from "./markdown";

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

// ── Rendered-markdown styling ────────────────────────────────────────────────
// The release body is injected HTML (see `./markdown`), so its descendant tags
// are styled via arbitrary variants on the container rather than a stylesheet.
const MARKDOWN =
  "text-[13px] leading-[1.7] text-muted-foreground " +
  "[&_h2]:mt-[18px] [&_h2]:mb-1.5 [&_h2]:text-[17px] [&_h2]:font-bold [&_h2]:text-foreground " +
  "[&_h3]:mt-[18px] [&_h3]:mb-1.5 [&_h3]:text-[15px] [&_h3]:font-bold [&_h3]:text-foreground " +
  "[&_h4]:mt-[18px] [&_h4]:mb-1.5 [&_h4]:text-[14px] [&_h4]:font-bold [&_h4]:text-foreground " +
  "[&_h5]:mt-[18px] [&_h5]:mb-1.5 [&_h5]:text-[14px] [&_h5]:font-bold [&_h5]:text-foreground " +
  "[&_p]:my-[5px] " +
  // Preflight resets `list-style: none` on ul/ol, so the markers must be asked
  // for explicitly — without these the release notes render as unbulleted lines.
  "[&_ul]:my-[5px] [&_ul]:list-disc [&_ul]:pl-[18px] [&_ol]:my-[5px] [&_ol]:list-decimal [&_ol]:pl-[22px] " +
  "[&_li]:my-[3px] [&_li]:marker:text-brand " +
  "[&_img]:my-1.5 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border [&_img]:border-border " +
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
