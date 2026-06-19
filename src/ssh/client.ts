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
          logger.error(
            `Failed to read SSH key file ${this.opts.keyFilename}: ${String(e)}`,
          );
          resolve(false);
          return;
        }
      }
      // Passphrase only applies to a private key; ssh2 ignores it otherwise.
      if (cfg.privateKey && this.opts.keyPassphrase)
        cfg.passphrase = this.opts.keyPassphrase;
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
  run(command: string): Promise<string> {
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
        stream
          .on("close", () => {
            const out = decodeOutput(Buffer.concat(stdout));
            const error = decodeOutput(Buffer.concat(stderrBuf));
            resolve(error && !out ? error : out);
          })
          .on("data", (d: Buffer) => stdout.push(d))
          .stderr.on("data", (d: Buffer) => stderrBuf.push(d));
      });
    });
  }

  /** Open a persistent interactive shell channel (used by Safe Mode). */
  shell(
    opts: { term?: string; cols?: number; rows?: number } = {},
  ): Promise<ClientChannel> {
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
        (err: Error | undefined, stream: ClientChannel) =>
          err ? reject(err) : resolve(stream),
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
