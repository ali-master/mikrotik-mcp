/**
 * SSH server settings — `/ip ssh`.
 *
 * RouterOS's SSH **server** configuration submenu (distinct from `/ip service
 * ssh`, which only controls the listening port/ACL). This is where TCP
 * forwarding, crypto strength, password-vs-key policy and the host key live —
 * notably `forwarding-enabled`, which a bastion needs set to `local`/`both` for
 * SSH ProxyJump (`jumpVia`) to work. Full coverage: every `/ip ssh` property
 * plus its host-key commands (regenerate / export / import).
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { DANGEROUS, READ, WRITE, WRITE_IDEMPOTENT, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { Cmd, isEmpty, looksLikeError } from "../core/routeros";

export const ipSshTools: ToolModule = [
  defineTool({
    name: "get_ssh_settings",
    title: "Get SSH Server Settings",
    annotations: READ,
    description:
      "Show the RouterOS SSH **server** configuration (`/ip ssh print`) — TCP forwarding policy " +
      "(`forwarding-enabled`), crypto strength (`strong-crypto`, `allow-none-crypto`), password-vs-key " +
      "policy (`always-allow-password-login`), and the host key (`host-key-type`, `host-key-size`). " +
      "This is the SSH SERVER's behaviour, separate from `/ip service ssh` (which only sets the SSH " +
      "port and source-address ACL — see get_ip_service). Use this to check, for example, whether a " +
      "router can act as an SSH jump host (`forwarding-enabled` must be `local` or `both`).",
    async handler(_a, ctx) {
      ctx.info("Reading /ip ssh settings");
      const result = await executeMikrotikCommand("/ip ssh print", ctx);
      return isEmpty(result)
        ? "No SSH server settings returned."
        : `SSH SERVER SETTINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_ssh_settings",
    title: "Configure SSH Server Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Update the RouterOS SSH **server** settings (`/ip ssh set`). Covers every option of the `/ip ssh` " +
      "submenu — pass only what you want to change:\n" +
      "• `forwarding_enabled` — TCP forwarding policy: `no` | `local` | `remote` | `both`. **Set to " +
      "`local` (or `both`) to let this router act as an SSH jump host / bastion** for ProxyJump " +
      "(`jumpVia`); `remote` allows reverse forwarding.\n" +
      "• `strong_crypto` — use stronger crypto: prefer 256-bit+ ciphers, bigger DH primes, stronger HMACs, " +
      "and disable weak/legacy algorithms (recommended for hardening).\n" +
      "• `always_allow_password_login` — allow password auth even when the user has an SSH public key set.\n" +
      "• `allow_none_crypto` — allow connecting with NO encryption (insecure; almost always keep off).\n" +
      "• `host_key_type` — host key algorithm: `rsa` or `ed25519`. Changing it regenerates the host key, so " +
      "existing clients will see a changed key and must re-trust it.\n" +
      "• `host_key_size` — RSA host-key size in bits (e.g. 2048 or 4096); applies to `rsa` host keys.\n" +
      "Note: this is NOT the SSH port/ACL — for that use set_ip_service on the `ssh` service.",
    inputSchema: {
      forwarding_enabled: z
        .enum(["no", "local", "remote", "both"])
        .optional()
        .describe(
          "TCP forwarding policy. `local`/`both` are required for this router to be a jump host.",
        ),
      strong_crypto: z
        .boolean()
        .optional()
        .describe("Prefer strong ciphers/MACs/DH and disable weak ones (hardening)."),
      always_allow_password_login: z
        .boolean()
        .optional()
        .describe("Allow password login even when the user has an SSH public key configured."),
      allow_none_crypto: z
        .boolean()
        .optional()
        .describe("Allow unencrypted connections (insecure — keep off unless you must)."),
      host_key_type: z
        .enum(["rsa", "ed25519"])
        .optional()
        .describe(
          "Host key algorithm. Changing it regenerates the host key (clients must re-trust).",
        ),
      host_key_size: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("RSA host-key size in bits (e.g. 2048, 4096). Applies to rsa host keys."),
    },
    async handler(a, ctx) {
      const provided = [
        a.forwarding_enabled,
        a.strong_crypto,
        a.always_allow_password_login,
        a.allow_none_crypto,
        a.host_key_type,
        a.host_key_size,
      ].some((v) => v !== undefined);
      if (!provided) {
        return (
          "No settings specified. Provide at least one of: forwarding_enabled, strong_crypto, " +
          "always_allow_password_login, allow_none_crypto, host_key_type, host_key_size."
        );
      }

      ctx.info("Updating /ip ssh settings");
      const cmd = new Cmd("/ip ssh set")
        .opt("forwarding-enabled", a.forwarding_enabled)
        .bool("strong-crypto", a.strong_crypto)
        .bool("always-allow-password-login", a.always_allow_password_login)
        .bool("allow-none-crypto", a.allow_none_crypto)
        .opt("host-key-type", a.host_key_type)
        .opt("host-key-size", a.host_key_size)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update SSH server settings: ${result}`;

      const after = await executeMikrotikCommand("/ip ssh print", ctx);
      return `SSH server settings updated:\n\n${after}`;
    },
  }),

  defineTool({
    name: "regenerate_ssh_host_key",
    title: "Regenerate SSH Host Key",
    annotations: DANGEROUS,
    description:
      "Regenerate the router's SSH host key (`/ip ssh regenerate-host-key`), using the current " +
      "`host-key-type`/`host-key-size`. WARNING: this changes the server's identity — EVERY existing " +
      "SSH client will get a host-key-mismatch warning and must re-trust the router (remove its old " +
      "entry from `~/.ssh/known_hosts`). Do this only when rotating keys or after changing " +
      "`host_key_type`. It does not drop the current session.",
    async handler(_a, ctx) {
      ctx.info("Regenerating /ip ssh host key");
      const result = await executeMikrotikCommand("/ip ssh regenerate-host-key", ctx);
      if (looksLikeError(result)) return `Failed to regenerate SSH host key: ${result}`;
      return (
        "SSH host key regenerated. Existing clients will see a changed host key and must re-trust the " +
        `router (clear its old entry from known_hosts).${result.trim() ? `\n\n${result.trim()}` : ""}`
      );
    },
  }),

  defineTool({
    name: "export_ssh_host_key",
    title: "Export SSH Host Public Key",
    annotations: WRITE,
    description:
      "Export the router's SSH host public key to file(s) on the device (`/ip ssh export-host-key`), " +
      "named with the given prefix (e.g. prefix `myrouter` → `myrouter_*` files in `/file`). Useful to " +
      "pin/distribute the host key. Download the resulting file with download_file.",
    inputSchema: {
      key_file_prefix: z
        .string()
        .describe("Filename prefix for the exported key file(s), e.g. 'myrouter'."),
    },
    async handler(a, ctx) {
      ctx.info(`Exporting /ip ssh host key with prefix=${a.key_file_prefix}`);
      const cmd = new Cmd("/ip ssh export-host-key")
        .opt("key-file-prefix", a.key_file_prefix)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to export SSH host key: ${result}`;
      return `SSH host key exported with prefix '${a.key_file_prefix}'. List with list_files / download with download_file.`;
    },
  }),

  defineTool({
    name: "import_ssh_host_key",
    title: "Import SSH Host Key",
    annotations: DANGEROUS,
    description:
      "Import an SSH host key onto the router from key files already on the device (`/ip ssh " +
      "import-host-key`). Provide the private-key file and its matching public-key file (upload them " +
      "first with upload_file). WARNING: this replaces the server's host identity — existing clients " +
      "will see a changed host key and must re-trust the router.",
    inputSchema: {
      private_key_file: z.string().describe("Private-key filename on the device, e.g. 'host_key'."),
      public_key_file: z
        .string()
        .optional()
        .describe("Public-key filename on the device (e.g. 'host_key.pub'), if required."),
    },
    async handler(a, ctx) {
      ctx.info(`Importing /ip ssh host key from ${a.private_key_file}`);
      const cmd = new Cmd("/ip ssh import-host-key")
        .opt("private-key-file", a.private_key_file)
        .opt("public-key-file", a.public_key_file)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to import SSH host key: ${result}`;
      return (
        "SSH host key imported. Existing clients will see a changed host key and must re-trust the " +
        `router.${result.trim() ? `\n\n${result.trim()}` : ""}`
      );
    },
  }),
];
