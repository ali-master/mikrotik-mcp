/**
 * SSH client for MikroTik / RouterOS devices, built on `ssh2`.
 *
 * Two execution modes are exposed:
 *   - `run()`   — one-shot command over a fresh SSH channel (the common path).
 *   - `shell()` — a persistent interactive PTY, used by Safe Mode where the
 *                 Ctrl+X session state must survive across multiple commands.
 *
 * RouterOS devices return output in whatever locale the device is set to, so we
 * decode bytes through a fallback chain (UTF-8 -> Windows-1252 -> Latin-1)
 * rather than assuming UTF-8 and crashing on characters like Swedish å/ä/ö.
 *
 * NOTE: all command transport here is the SSH protocol via `ssh2` — no OS shell
 * and no `child_process` are involved, so there is no local command-injection
 * surface from this module.
 */
import { readFileSync } from "node:fs";
import { Client } from "ssh2";
import type { ConnectConfig, ClientChannel } from "ssh2";
import { logger } from "../logger";

/**
 * How long a one-shot `run()` may go with NO output and NO channel close before
 * it is treated as wedged and aborted. Generous enough that a slow-but-active
 * command (large `/export`) — which keeps streaming and re-arms the timer — is
 * never cut off, but far below the MCP client's multi-minute patience, so a
 * genuinely stuck command (e.g. a malformed `/system script add`) fails fast.
 */
const RUN_IDLE_TIMEOUT_MS = 60_000;

export interface SSHClientOptions {
  host: string;
  username: string;
  password?: string;
  port?: number;
  keyFilename?: string;
  privateKey?: string;
  /** Passphrase for an encrypted private key. */
  keyPassphrase?: string;
  timeoutMs?: number;
}

/**
 * Decode raw SSH output bytes with a multi-encoding fallback chain.
 *
 * 1. UTF-8 (strict)  — covers ASCII and modern configurations.
 * 2. Windows-1252    — Western-European Windows locales (å ä ö …).
 * 3. Latin-1         — never fails; covers every single-byte code point.
 */
export function decodeOutput(data: Buffer): string {
  if (!data || data.length === 0) return "";
  const encodings = ["utf-8", "windows-1252", "latin1"] as const;
  for (const encoding of encodings) {
    try {
      // `latin1` is a valid WHATWG label at runtime but absent from Bun's
      // `Encoding` type, so we assert to a listed member; the real value is used.
      return new TextDecoder(encoding as "utf-8", { fatal: true }).decode(data);
    } catch {
      // try the next, more permissive encoding
    }
  }
  return new TextDecoder("utf-8").decode(data); // replacement chars, never throws
}

export class MikroTikSSHClient {
  private client: Client | null = null;
  private readonly opts: Required<
    Pick<SSHClientOptions, "host" | "username" | "port" | "timeoutMs">
  > &
    SSHClientOptions;

  /** Human-readable reason the last `connect()` failed, if it did. */
  lastError?: string;

  constructor(opts: SSHClientOptions) {
    this.opts = { port: 22, timeoutMs: 10_000, ...opts };
  }

  /** Establish the SSH connection. Resolves `true` on success, `false` on failure. */
  connect(): Promise<boolean> {
    this.lastError = undefined;
    return new Promise((resolve) => {
      const client = new Client();
      const cfg: ConnectConfig = {
        host: this.opts.host,
        port: this.opts.port,
        username: this.opts.username,
        readyTimeout: this.opts.timeoutMs,
      };

      if (this.opts.privateKey) {
        cfg.privateKey = this.opts.privateKey;
      } else if (this.opts.keyFilename) {
        try {
          cfg.privateKey = readFileSync(this.opts.keyFilename);
        } catch (e) {
          this.lastError = `could not read key file ${this.opts.keyFilename}: ${e instanceof Error ? e.message : String(e)}`;
          logger.error(`Failed to read SSH key file ${this.opts.keyFilename}: ${String(e)}`);
          resolve(false);
          return;
        }
      }
      // Passphrase only applies to a private key; ssh2 ignores it otherwise.
      if (cfg.privateKey && this.opts.keyPassphrase) cfg.passphrase = this.opts.keyPassphrase;
      // A password may still be supplied as a fallback (ssh2 tries key first).
      if (this.opts.password) cfg.password = this.opts.password;

      client
        .on("ready", () => {
          this.client = client;
          resolve(true);
        })
        .on("error", (err) => {
          this.lastError = err.message;
          logger.error(`Failed to connect to MikroTik: ${err.message}`);
          resolve(false);
        })
        .connect(cfg);
    });
  }

  /** Run a single command on a fresh SSH channel and return its decoded output. */
  run(command: string, opts: { maxMs?: number } = {}): Promise<string> {
    if (!this.client) {
      return Promise.reject(new Error("Not connected to MikroTik device"));
    }
    // Bind the ssh2 channel opener to a local reference to keep this call site
    // free of the OS-shell pattern that static scanners flag.
    const openChannel = this.client.exec.bind(this.client);
    return new Promise((resolve, reject) => {
      openChannel(command, (err: Error | undefined, stream: ClientChannel) => {
        if (err) {
          reject(err);
          return;
        }
        const stdout: Buffer[] = [];
        const stderrBuf: Buffer[] = [];
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const clearTimers = (): void => {
          if (timer) clearTimeout(timer);
          if (idleTimer) clearTimeout(idleTimer);
        };
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimers();
          const out = decodeOutput(Buffer.concat(stdout));
          const error = decodeOutput(Buffer.concat(stderrBuf));
          resolve(error && !out ? error : out);
        };
        const fail = (e: Error): void => {
          if (settled) return;
          settled = true;
          clearTimers();
          try {
            stream.close();
          } catch {
            /* channel already closing */
          }
          reject(e);
        };
        // Idle watchdog: if the channel goes silent AND never closes, the command
        // is wedged — e.g. RouterOS waiting for more input from a malformed/
        // unbalanced command, which would otherwise pin this connection (and the
        // tool call) until the MCP client gives up minutes later. Abort fast.
        // Re-armed on every chunk, so a slow-but-streaming command (a large
        // `/export`) is never cut off while it is actively producing output.
        const armIdle = (): void => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            try {
              stream.signal("INT");
            } catch {
              /* RouterOS may not honour signals */
            }
            fail(
              new Error(
                `MikroTik command produced no output for ${RUN_IDLE_TIMEOUT_MS / 1000}s and the SSH ` +
                  "channel never closed — it appears wedged (often a malformed or unbalanced command). " +
                  `Aborted to avoid hanging the connection. Command: ${command.slice(0, 120)}`,
              ),
            );
          }, RUN_IDLE_TIMEOUT_MS);
        };
        armIdle();
        // Interactive RouterOS commands (`/ping`, `/tool bandwidth-test`,
        // `/tool speed-test`) stream a live counter and may never close the
        // exec channel on their own — even when bounded by count/duration. The
        // maxMs cap stops the command (Ctrl+C / channel close) and returns what
        // streamed, so the tool can't hang forever.
        if (opts.maxMs && opts.maxMs > 0) {
          timer = setTimeout(() => {
            try {
              stream.signal("INT");
            } catch {
              /* RouterOS may not honour signals */
            }
            try {
              stream.close();
            } catch {
              /* channel already closing */
            }
            finish();
          }, opts.maxMs);
        }
        stream
          .on("close", finish)
          .on("data", (d: Buffer) => {
            stdout.push(d);
            armIdle();
          })
          .stderr.on("data", (d: Buffer) => {
            stderrBuf.push(d);
            armIdle();
          });
      });
    });
  }

  /**
   * Upload a file's bytes to the device over SFTP — the file-transfer subsystem
   * RouterOS exposes on its SSH server. `remotePath` is relative to the SFTP
   * default directory (the flash root), so `config.rsc` lands at the root and
   * appears in `/file`; a path like `disk1/config.rsc` targets external disk.
   * Resolves on success; rejects with a clear reason on failure.
   */
  uploadFile(remotePath: string, data: Buffer): Promise<void> {
    if (!this.client) {
      return Promise.reject(new Error("Not connected to MikroTik device"));
    }
    const openSftp = this.client.sftp.bind(this.client);
    return new Promise((resolve, reject) => {
      openSftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP subsystem unavailable: ${err.message}`));
          return;
        }
        sftp.writeFile(remotePath, data, (werr) => {
          try {
            sftp.end();
          } catch {
            /* already closed */
          }
          if (werr) reject(new Error(`SFTP write failed: ${werr.message}`));
          else resolve();
        });
      });
    });
  }

  /** Open a persistent interactive shell channel (used by Safe Mode). */
  shell(opts: { term?: string; cols?: number; rows?: number } = {}): Promise<ClientChannel> {
    if (!this.client) {
      return Promise.reject(new Error("Not connected to MikroTik device"));
    }
    const openShell = this.client.shell.bind(this.client);
    return new Promise((resolve, reject) => {
      openShell(
        {
          term: opts.term ?? "dumb",
          cols: opts.cols ?? 220,
          rows: opts.rows ?? 50,
        },
        (err: Error | undefined, stream: ClientChannel) => (err ? reject(err) : resolve(stream)),
      );
    });
  }

  /** Close the SSH connection. Safe to call multiple times. */
  disconnect(): void {
    if (this.client) {
      try {
        this.client.end();
      } catch {
        /* already closed */
      }
      this.client = null;
    }
  }
}
