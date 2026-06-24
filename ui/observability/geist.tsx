/**
 * Geist UI kit — a small set of reusable components modeled on Vercel's Geist
 * design system (geist.vercel.com): Button, Note, Badge, Dot, Spinner, Input,
 * Select, Card, Tooltip.
 *
 * Vercel's official Geist ships only fonts on npm and its React components are
 * not published; the community `@geist-ui/core` targets React 16–18. So rather
 * than pull in an incompatible dependency, these are hand-built to the Geist
 * spec — same component names, variants (types) and feel — styled from the
 * dashboard's `--mt-*` / `--page-accent` tokens so the whole UI uses ONE coherent
 * component vocabulary. Styling lives in `styles.css` under `.geist-*`.
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

/** Geist semantic colour variants, shared by Button / Note / Badge / Dot. */
export type GeistType = "default" | "secondary" | "success" | "warning" | "error" | "accent";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** Geist semantic variant (NOT the native button type — that is always "button"). */
  type?: GeistType;
  size?: "sm" | "md";
  /** Render a quieter, border-only treatment. */
  ghost?: boolean;
  /** Show a spinner and disable while an async action runs. */
  loading?: boolean;
  /** Leading icon node. */
  icon?: ReactNode;
}

/** Geist Button. `type` selects the semantic variant (not the HTML button type). */
export function Button({
  type = "default",
  size = "md",
  ghost = false,
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={[
        "geist-btn",
        `geist-btn--${type}`,
        `geist-btn--${size}`,
        ghost ? "geist-btn--ghost" : "",
        loading ? "is-loading" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner small /> : icon && <span className="geist-btn__icon">{icon}</span>}
      {children != null && <span className="geist-btn__label">{children}</span>}
    </button>
  );
}

/** Geist Note — a labelled callout for inline guidance, warnings and errors. */
export function Note({
  type = "default",
  label,
  children,
  className = "",
}: {
  type?: GeistType;
  /** Bold lead-in label; pass `false` to omit. Defaults to the type name. */
  label?: ReactNode | false;
  children: ReactNode;
  className?: string;
}): ReactNode {
  const lead = label === false ? null : (label ?? type);
  return (
    <div className={`geist-note geist-note--${type} ${className}`.trim()} role="note">
      {lead != null && <b className="geist-note__label">{lead}:</b>} {children}
    </div>
  );
}

/** Geist Badge — a small status/label pill. */
export function Badge({
  type = "default",
  children,
  className = "",
}: {
  type?: GeistType;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return <span className={`geist-badge geist-badge--${type} ${className}`.trim()}>{children}</span>;
}

/** Geist Dot — a coloured status indicator, optionally pulsing. */
export function Dot({
  type = "default",
  pulse = false,
  color,
  className = "",
}: {
  type?: GeistType;
  pulse?: boolean;
  /** Explicit colour override (e.g. a persisted per-device colour). */
  color?: string;
  className?: string;
}): ReactNode {
  return (
    <span
      className={`geist-dot geist-dot--${type}${pulse ? " is-pulse" : ""} ${className}`.trim()}
      style={color ? { background: color } : undefined}
    />
  );
}

/** Geist Spinner — the signature stepped-bars loading indicator. */
export function Spinner({ small = false }: { small?: boolean }): ReactNode {
  return (
    <span className={`geist-spinner${small ? " geist-spinner--sm" : ""}`} aria-label="loading">
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          style={{ transform: `rotate(${i * 30}deg)`, animationDelay: `${-1.1 + i * 0.1}s` }}
        />
      ))}
    </span>
  );
}

/** Geist Input. */
export function Input({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return <input className={`geist-input ${className}`.trim()} {...rest} />;
}

/** Geist Select. */
export function Select({
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  return (
    <select className={`geist-select ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}

/** Geist Card — a bordered surface for grouping content. */
export function Card({
  children,
  className = "",
  hoverable = false,
}: {
  children: ReactNode;
  className?: string;
  hoverable?: boolean;
}): ReactNode {
  return (
    <div className={`geist-card${hoverable ? " is-hoverable" : ""} ${className}`.trim()}>
      {children}
    </div>
  );
}

/** Geist Tooltip — a hover/focus popover (CSS-driven). */
export function Tooltip({
  text,
  children,
  className = "",
}: {
  text: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <span className={`geist-tooltip ${className}`.trim()} tabIndex={0}>
      {children}
      <span className="geist-tooltip__pop" role="tooltip">
        {text}
      </span>
    </span>
  );
}
