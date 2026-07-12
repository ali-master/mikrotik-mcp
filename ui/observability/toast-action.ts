/**
 * Shared Sonner-toast wrapper for every dashboard mutation/action.
 *
 * Wraps an async action in a loading → success / error toast, so every write in
 * the dashboard gives consistent feedback. Returns the result on success, or
 * `null` on failure (so callers can `if (!r) return;` and skip their happy path).
 *
 * Failure is detected the way the dashboard routes reply: an explicit
 * `ok === false`, or (when a route doesn't send `ok`) any truthy `error`. A
 * thrown/rejected request (network failure) is caught and toasted too.
 */
import { toast } from "@/components/ui/sonner";

export interface ActionResult {
  ok?: boolean;
  error?: string;
  message?: string;
}

interface Messages<T> {
  loading: string;
  success: string | ((r: T) => string);
  /** Fallback error text when the response carries none. */
  error?: string;
}

export async function toastAction<T extends ActionResult>(
  action: () => Promise<T>,
  msgs: Messages<T>,
): Promise<T | null> {
  const id = toast.loading(msgs.loading);
  try {
    const r = await action();
    const failed = r == null || r.ok === false || (r.ok !== true && !!r.error);
    if (failed) {
      toast.error(r?.error ?? r?.message ?? msgs.error ?? "Request failed", { id });
      return null;
    }
    toast.success(typeof msgs.success === "function" ? msgs.success(r) : msgs.success, { id });
    return r;
  } catch (e) {
    toast.error(msgs.error ?? (e instanceof Error ? e.message : "Request failed"), { id });
    return null;
  }
}

export { toast };
