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
      const response = await this.readUntilPrompt(10_000);
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

  /** Send Ctrl+X again to exit Safe Mode and persist all changes. */
  commit(): Promise<string> {
    return this.lock(async () => {
      if (!this.active || !this.channel) return "Safe mode is not active. Nothing to commit.";
      this.channel.write(CTRL_X);
      const response = await this.readUntilPrompt(15_000);
      this.cleanup();
      return response.includes("<SAFE>")
        ? `Commit attempted. Response: ${response.slice(0, 200)}`
        : "Changes committed successfully. Safe mode DISABLED.";
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

  private readUntilPrompt(timeoutMs = 15_000): Promise<string> {
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
        if (PROMPT_RE.test(cleaned)) finish(cleaned);
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
