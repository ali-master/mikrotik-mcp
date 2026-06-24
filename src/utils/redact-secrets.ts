/**
 * Mask sensitive values in RouterOS print output before returning it to the
 * model. RouterOS prints secrets inline as `key="value"`, so we replace the
 * value of every known-sensitive key with `***`.
 *
 * This consolidates what used to be several near-identical per-module helpers
 * (`redactPassword`, `redact`). Masking a key that isn't present is a no-op, so
 * one function safely covers every caller (PPP/PPTP/L2TP/SSTP/OpenVPN secrets,
 * RADIUS shared-secrets, User-Manager passwords, local user passwords, …).
 *
 * A negative lookbehind for `[\w-]` ensures we match a *whole* attribute key:
 * `secret="x"` inside `shared-secret="x"` is not matched separately, so
 * `shared-secret` is handled by its own alternative rather than being
 * half-masked.
 */
const SENSITIVE_KEYS = ["password", "shared-secret", "secret"] as const;

const REDACT_RE = new RegExp(`(?<![\\w-])(${SENSITIVE_KEYS.join("|")})="[^"]*"`, "g");

export function redactSecrets(text: string): string {
  return text.replace(REDACT_RE, '$1="***"');
}
