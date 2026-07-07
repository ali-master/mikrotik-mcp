import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Button } from "./geist";

/**
 * Reusable right-anchored slide-over sheet. Reuses the existing `.overlay`/`.sheet`
 * pattern (from `detail-drawer.tsx`) and adds Esc-to-close (as `whats-new.tsx` does).
 * Dismisses on backdrop click, the ✕ button, or Escape.
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Render into <body> via a portal so the overlay covers the whole page and is
  // never clipped/positioned by an ancestor (the Configuration panel sets up its
  // own containing block via overflow/transform).
  return createPortal(
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet cfg-sheet" role="dialog" aria-modal="true">
        <div className="sheet__hd">
          <h3 className="sheet__tool">{title}</h3>
          {subtitle != null && <span className="muted cfg-sheet__sub">{subtitle}</span>}
          <span style={{ flex: 1 }} />
          <Button type="secondary" size="sm" onClick={onClose}>
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
