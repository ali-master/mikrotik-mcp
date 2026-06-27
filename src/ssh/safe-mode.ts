/**
 * Manages a persistent interactive SSH session for MikroTik **Safe Mode**.
 *
 * Safe Mode is activated by sending Ctrl+X (0x18) to the interactive shell.
 * While active, every configuration change is held in memory only — a reboot or
 * a dropped session reverts all of them automatically. Sending Ctrl+X a second
 * time commits the changes and exits Safe Mode.
 *
 * This is the one place we keep a long-lived channel open: a one-shot `exec`
 * channel per command would each get its own session and could never share the
 * Safe-Mode state, so commands issued while Safe Mode is active are funnelled
 * through the single persistent shell held here.
 */
import type { ClientChannel } from "ssh2";
import { MikroTikSSHClient, decodeOutput } from "./client";
import { getDevice } from "../core/runtime";

/** Matches RouterOS prompts in both normal and safe mode:
 *   [admin@MikroTik] >
 *   [admin@MikroTik] <SAFE> >
 */
// eslint-disable-next-line regexp/no-super-linear-backtracking
const PROMPT_RE = /\[.+?@.+?\] (?:<SAFE> )?> ?$/m;

/** Strip ANSI/VT escape sequences RouterOS emits on interactive shells. */
const ANSI_RE =
  // oxlint-disable-next-line no-control-regex
  /\x1B(?:\[[0-9;]*[mA-HJ-MSTfhilnprsu]|[()][0-9A-Za-z]|\[?\?\d+[hl])/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

const CTRL_X = "\x18";

/**
 * True when a RouterOS Ctrl+X response confirms Safe Mode is active. RouterOS
 * signals this in one of two ways depending on version and terminal type:
 *   • the prompt redraws with the `<SAFE>` marker (the common case), or
 *   • it prints a textual confirmation like "Taking Safe Mode session...
 *     Success!" or "Safe Mode taken" (seen on `dumb` terminals / some v7
 *     builds) while leaving the prompt unchanged.
 * Accept either so activation isn't falsely reported as a failure.
 */
export function isSafeModeActivated(response: string): boolean {
  if (response.includes("<SAFE>")) return true;
  return /safe mode[^\n]*\b(?:success|taken|enabled|active)\b/i.test(response);
}

/** The last non-empty, CR-stripped, right-trimmed line of a response buffer. */
function lastNonEmptyLine(response: string): string {
  const lines = response
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean);
  return lines.at(-1) ?? "";
}

/**
 * Classify the shell's CURRENT mode from its settled output, by looking at the
 * last prompt line:
 *   • `"safe"`     — a `<SAFE>` prompt: Safe Mode is still active.
 *   • `"released"` — a normal prompt with no `<SAFE>`: Safe Mode has exited.
 *   • `"unknown"`  — no recognisable prompt (timed out / wedged): caller must
 *     not assume either state (closing on a false "released" would be safe, but
 *     reporting a false "committed" would be a lie; reporting a false "safe"
 *     would loop).
 *
 * This drives the commit logic, which presses Enter to force a deterministic
 * redraw and then reads the settled prompt — far more reliable than hoping
 * RouterOS spontaneously redraws after the commit Ctrl+X (it often doesn't on a
 * `dumb` terminal).
 */
export function classifyPrompt(response: string): "safe" | "released" | "unknown" {
  const last = lastNonEmptyLine(response);
  if (!PROMPT_RE.test(last)) return "unknown";
  return last.includes("<SAFE>") ? "safe" : "released";
}

/** True when output confirms Safe Mode has been RELEASED (normal prompt). */
export function isSafeModeReleased(response: string): boolean {
  return classifyPrompt(response) === "released";
}

/**
 * Outcome of {@link SafeModeManager.commit}. `ok` is true ONLY when Safe Mode is
 * confirmed exited (changes persisted) — callers must check it before telling
 * the user anything was committed, so a failed commit can never masquerade as a
 * success that then silently reverts.
 */
export interface CommitResult {
  ok: boolean;
  message: string;
}

export class SafeModeManager {
  private ssh: MikroTikSSHClient | null = null;
  private channel: ClientChannel | null = null;
  private active = false;
  /** Serializes channel access so concurrent tool calls don't interleave I/O. */
  private queue: Promise<unknown> = Promise.resolve();

  /** The device this Safe Mode session belongs to (a configured device name). */
  constructor(private readonly deviceName: string) {}

  get isActive(): boolean {
    return this.active;
  }

  /** Run `fn` exclusively — the persistent channel must not be shared mid-command. */
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Open a persistent SSH shell and activate MikroTik Safe Mode. */
  enable(): Promise<string> {
    return this.lock(async () => {
      if (this.active) return "Safe mode is already active.";

      const dc = getDevice(this.deviceName);
      // Safe Mode rides a persistent SSH shell (Ctrl+X). A MAC-Telnet device has
      // no SSH transport, so Safe Mode is not available there.
      if (dc.mac) {
        return (
          "Error: Safe Mode is not supported for a MAC-Telnet device " +
          `('${this.deviceName}' is reached by MAC ${dc.mac}). ` +
          "Connect over SSH (configure host/credentials) to use Safe Mode."
        );
      }
      const ssh = new MikroTikSSHClient({
        host: dc.host,
        username: dc.username,
        password: dc.password,
        keyFilename: dc.keyFilename,
        privateKey: dc.privateKey,
        keyPassphrase: dc.keyPassphrase,
        port: dc.port,
        timeoutMs: dc.timeoutMs,
      });
      if (!(await ssh.connect())) {
        return "Error: Failed to connect to MikroTik device for safe mode session.";
      }

      this.ssh = ssh;
      this.channel = await ssh.shell({ term: "dumb", cols: 220, rows: 50 });

      const initial = await this.readUntilPrompt(20_000);
      if (!PROMPT_RE.test(initial)) {
        this.cleanup();
        return `Error: Timed out waiting for MikroTik shell prompt. Got: ${JSON.stringify(initial.slice(0, 300))}`;
      }

      this.channel.write(CTRL_X);
      // Wait specifically for the activation signal, not just any prompt: right
      // after Ctrl+X RouterOS can echo a redraw of the still-normal prompt
      // before the `<SAFE>` marker appears, which would otherwise be misread as
      // "did not activate". Fall back to the timeout buffer either way.
      const response = await this.readUntilPrompt(10_000, (c) => isSafeModeActivated(c));
      // Activation is confirmed EITHER by the prompt switching to the `<SAFE>`
      // marker (the usual case) OR by RouterOS printing a textual confirmation
      // — some versions/terminal types emit "Taking Safe Mode session...
      // Success!" (or "Safe Mode taken") instead of redrawing the prompt with
      // `<SAFE>`, especially on a `dumb` terminal. Treat either as success.
      if (!isSafeModeActivated(response)) {
        this.cleanup();
        return `Error: Safe mode did not activate. Response: ${JSON.stringify(response.slice(0, 300))}`;
      }

      this.active = true;
      return (
        "Safe mode ENABLED. All changes are temporary — they will be reverted " +
        "automatically if the connection drops or you call rollback_safe_mode. " +
        "Call commit_safe_mode to make changes permanent."
      );
    });
  }

  /** Execute a command through the safe-mode persistent shell session. */
  execute(command: string): Promise<string> {
    return this.lock(async () => {
      if (!this.active || !this.channel) {
        throw new Error("Safe mode session is not active.");
      }
      this.channel.write(`${command}\n`);
      const raw = await this.readUntilPrompt();
      return this.extractOutput(raw, command);
    });
  }

  /**
   * Send Ctrl+X again to exit Safe Mode and persist all changes. Returns a
   * structured result so callers NEVER report "committed" on a failed commit —
   * `ok` is true only when Safe Mode is confirmed exited (changes saved).
   */
  commit(): Promise<CommitResult> {
    return this.lock(async () => {
      if (!this.active || !this.channel) {
        return { ok: true, message: "Safe mode is not active. Nothing to commit." };
      }

      // PROBE FIRST with a sentinel round-trip. A previous commit may have
      // actually succeeded even though detection was flaky (leaving us `active`).
      // If the device is already in normal mode, the changes are committed —
      // report success rather than sending another Ctrl+X (which would RE-ENTER
      // Safe Mode and start the flaky loop the caller saw).
      const before = await this.probeMode();
      if (before === "released") {
        this.cleanup();
        return {
          ok: true,
          message: "Safe mode already exited — your changes are committed. Safe mode DISABLED.",
        };
      }
      if (before === "unknown") {
        return {
          ok: false,
          message:
            "Could not read a prompt to determine Safe Mode state. The session is left open so " +
            "nothing is reverted — call get_safe_mode_status, retry commit_safe_mode, or rollback_safe_mode.",
        };
      }

      // Confirmed still in Safe Mode → commit (Ctrl+X), then VERIFY with another
      // sentinel round-trip. We report "committed" ONLY when the sentinel comes
      // back at a normal (non-`<SAFE>`) prompt — proof Safe Mode actually exited,
      // not a transient redraw. We only tear the channel down once that release
      // is confirmed (closing while still `<SAFE>` would look like a dropped
      // session and auto-revert the very changes we are committing).
      this.channel.write(CTRL_X);
      const after = await this.probeMode();
      switch (after) {
        case "released":
          this.cleanup();
          return { ok: true, message: "Changes committed successfully. Safe mode DISABLED." };
        case "safe":
          return {
            ok: false,
            message:
              "Commit NOT completed — the device is still in Safe Mode (the Ctrl+X commit did not " +
              "take). Your changes remain held in memory and are NOT yet saved; call commit_safe_mode " +
              "again to retry, or rollback_safe_mode to discard them. If retries keep failing, this " +
              "RouterOS build may not accept an interactive Safe Mode commit over SSH — apply the " +
              "change without Safe Mode instead.",
          };
        default:
          return {
            ok: false,
            message:
              "Commit status unclear — no prompt seen after the commit. The session is left open so " +
              "nothing is reverted; verify with get_safe_mode_status or retry commit_safe_mode.",
          };
      }
    });
  }

  /** Close the session to trigger MikroTik's automatic safe-mode revert. */
  rollback(): Promise<string> {
    return this.lock(async () => {
      if (!this.active) return "Safe mode is not active. Nothing to roll back.";
      this.cleanup();
      return "Safe mode session closed. MikroTik has reverted all uncommitted changes automatically.";
    });
  }

  status(): string {
    return this.active
      ? "Safe mode is ACTIVE. Changes are pending — they are NOT yet persisted. " +
          "Call commit_safe_mode to persist or rollback_safe_mode to revert."
      : "Safe mode is NOT active. Changes take effect and persist immediately.";
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Read from the channel until `isDone(cleaned)` is satisfied or the timeout
   * elapses. Defaults to "any RouterOS prompt appeared". Mode transitions pass a
   * stricter predicate so they wait for the prompt that reflects the NEW state
   * (safe-mode marker present/absent), not merely the first prompt-shaped line.
   */
  private readUntilPrompt(
    timeoutMs = 15_000,
    isDone: (cleaned: string) => boolean = (c) => PROMPT_RE.test(c),
  ): Promise<string> {
    const channel = this.channel;
    if (!channel) return Promise.resolve("");
    return new Promise((resolve) => {
      let buf = "";
      // Function declarations are hoisted, so onData/finish can reference each
      // other; `timer` is assigned before any listener can fire.
      let timer: ReturnType<typeof setTimeout>;
      function onData(chunk: Buffer): void {
        buf += decodeOutput(chunk);
        const cleaned = stripAnsi(buf);
        if (isDone(cleaned)) finish(cleaned);
      }
      function finish(result: string): void {
        clearTimeout(timer);
        // `channel` is non-null past the early return above; the hoisted
        // function declaration just doesn't carry that narrowing.
        channel!.removeListener("data", onData);
        resolve(result);
      }
      timer = setTimeout(() => finish(stripAnsi(buf)), timeoutMs);
      channel.on("data", onData);
    });
  }

  /**
   * Determine the shell's CURRENT mode definitively by round-tripping a sentinel
   * command (`:put "<token>"`) and classifying the prompt that follows ITS
   * output. A real command — not a bare Enter — forces RouterOS to fully process
   * any pending Ctrl+X and render a prompt that reflects the true mode, so we
   * never settle on a transient `<SAFE>`→normal redraw and report a commit that
   * did not actually take. Returns `safe`, `released`, or `unknown` (no prompt).
   */
  private async probeMode(): Promise<"safe" | "released" | "unknown"> {
    if (!this.channel) return "unknown";
    const token = "__MCP_SAFEMODE_PROBE__";
    this.channel.write(`:put "${token}"\n`);
    // Settle only once the sentinel's OUTPUT is on screen AND a prompt follows
    // it — i.e. the command fully round-tripped at the current prompt.
    const out = await this.readUntilPrompt(8_000, (cleaned) => {
      const i = cleaned.lastIndexOf(token);
      return i >= 0 && PROMPT_RE.test(cleaned.slice(i));
    });
    return classifyPrompt(out);
  }

  private extractOutput(raw: string, command: string): string {
    const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = text.split("\n");
    const result: string[] = [];
    let pastEcho = false;
    for (const line of lines) {
      const stripped = line.trim();
      if (!pastEcho) {
        if (stripped.includes(command.trim())) pastEcho = true;
        continue;
      }
      if (PROMPT_RE.test(stripped)) break;
      result.push(line);
    }
    return result.join("\n").trim();
  }

  private cleanup(): void {
    this.active = false;
    if (this.channel) {
      try {
        this.channel.end();
      } catch {
        /* already closed */
      }
      this.channel = null;
    }
    if (this.ssh) {
      this.ssh.disconnect();
      this.ssh = null;
    }
  }
}

// One Safe Mode session per device — each router holds its own pending changes.
const managers = new Map<string, SafeModeManager>();

export function getSafeModeManager(deviceName: string): SafeModeManager {
  let m = managers.get(deviceName);
  if (!m) {
    m = new SafeModeManager(deviceName);
    managers.set(deviceName, m);
  }
  return m;
}
