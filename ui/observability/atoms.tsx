import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

// ── small UI atoms ───────────────────────────────────────────────────────────
export function Panel({
  title,
  extra,
  children,
  className,
}: {
  title?: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={`panel${className ? ` ${className}` : ""}`}>
      {title != null && (
        <div className="sheet__hd" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          {extra != null && (
            <>
              <span style={{ flex: 1 }} />
              {extra}
            </>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatCard({
  k,
  v,
  sub,
  cls,
}: {
  k: string;
  v: string;
  sub?: string;
  cls?: string;
}): ReactNode {
  return (
    <div className={`stat${cls ? ` ${cls}` : ""}`}>
      <p className="k">{k}</p>
      <div className="v">
        {v}
        {sub != null && <small> {sub}</small>}
      </div>
    </div>
  );
}

export function HBars({
  rows,
}: {
  rows: { label: string; value: number; sub?: string; color?: string }[];
}): ReactNode {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbar">
      {rows.map((r) => (
        <div className="hbar__row" key={r.label}>
          <span className="hbar__label" title={r.label}>
            {r.label}
          </span>
          <div className="hbar__track">
            <div
              className="hbar__fill"
              style={{
                width: `${(r.value / max) * 100}%`,
                background: r.color,
              }}
            />
          </div>
          <span className="hbar__val">{r.sub ?? String(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** A clipboard glyph for icon-only copy affordances. */
export function CopyIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/**
 * Copy-to-clipboard button with an inline "Copied!" confirmation tooltip. Pass
 * `icon` for an icon-only affordance (e.g. next to a title); otherwise a text
 * label is shown. The tooltip auto-dismisses after a moment.
 */
export function CopyButton({
  text,
  label = "Copy",
  className = "btn",
  icon = false,
  title,
}: {
  text: string;
  label?: ReactNode;
  className?: string;
  icon?: boolean;
  title?: string;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (tRef.current && clearTimeout(tRef.current)), []);
  const onClick = (): void => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        if (tRef.current) clearTimeout(tRef.current);
        tRef.current = setTimeout(() => setCopied(false), 1400);
      },
      () => {},
    );
  };
  return (
    <button
      type="button"
      className={`copybtn ${className}${icon ? " copybtn--icon" : ""}${copied ? " is-copied" : ""}`}
      onClick={onClick}
      title={title ?? "Copy to clipboard"}
      aria-label={title ?? "Copy to clipboard"}
    >
      {icon ? <CopyIcon /> : label}
      <span className="copybtn__tip" role="status" aria-live="polite">
        Copied!
      </span>
    </button>
  );
}
