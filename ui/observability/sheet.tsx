import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Button } from "./geist";

/** Enter/exit transition duration — must match the CSS on `.cfg-overlay`/`.cfg-sheet`. */
const ANIM_MS = 260;

/**
 * Reusable right-anchored slide-over sheet. Reuses the existing `.overlay`/`.sheet`
 * pattern (from `detail-drawer.tsx`) and adds Esc-to-close (as `whats-new.tsx` does).
 * Dismisses on backdrop click, the ✕ button, or Escape.
 *
 * Animates open (overlay fades + panel slides in from the right) and close. Because
 * the exit animation needs the DOM to stay mounted while it plays, the sheet owns an
 * `open` flag: it mounts closed, flips open on the next frame to trigger the enter
 * transition, and on any dismissal flips closed then defers the parent's `onClose`
 * until the transition finishes (`ANIM_MS`).
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  footer,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read the latest onClose from a ref so the once-bound Esc listener and the
  // deferred close never fire a stale parent callback.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Play the exit animation, then hand control back to the parent to unmount us.
  const requestClose = useRef((): void => {
    if (closeTimer.current) return; // already closing
    setOpen(false);
    closeTimer.current = setTimeout(() => onCloseRef.current(), ANIM_MS);
  }).current;

  // Flip to open on the frame after mount (so the closed→open transition runs),
  // and wire Esc-to-close. Cleanup cancels the pending frame/close timer.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [requestClose]);

  // Render into <body> via a portal so the overlay covers the whole page and is
  // never clipped/positioned by an ancestor (the Configuration panel sets up its
  // own containing block via overflow/transform).
  return createPortal(
    <div
      className="overlay cfg-overlay"
      data-open={open ? "1" : undefined}
      onClick={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div className="sheet cfg-sheet" role="dialog" aria-modal="true">
        <div className="sheet__hd">
          <h3 className="sheet__tool">{title}</h3>
          {subtitle != null && <span className="muted cfg-sheet__sub">{subtitle}</span>}
          <span style={{ flex: 1 }} />
          <Button type="secondary" size="sm" onClick={requestClose}>
            ✕ Close
          </Button>
        </div>
        <div className="cfg-sheet__body">{children}</div>
        {footer != null && <div className="cfg-sheet__ft">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
