/**
 * Certificate Steward — lifecycle helpers on top of the base `/certificate`
 * tools: a one-call expiry audit so a tunnel never silently dies on an expired
 * cert, and Let's Encrypt issuance/renewal via RouterOS's built-in ACME client.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";
import { parseCertExpiry } from "../core/routeros-parse";

export const certStewardTools: ToolModule = [
  defineTool({
    name: "audit_certificate_expiry",
    title: "Audit Certificate Expiry",
    annotations: READ,
    description:
      "Scans every certificate in the device store (`/certificate print detail`) and reports how " +
      "long until each one expires — sorted by urgency, with anything ALREADY EXPIRED or expiring " +
      "within `warn_within_days` (default 30) flagged first. Use this to catch a TLS cert (SSTP, " +
      "API-SSL, hotspot, REST/www-ssl) before it lapses and silently breaks a service. For the full " +
      "detail of one certificate use get_certificate; to obtain/renew a Let's Encrypt cert use " +
      "request_letsencrypt_certificate. Returns a grouped report (expired · expiring soon · ok), " +
      "plus any certs with no parseable expiry (e.g. unsigned templates).",
    inputSchema: {
      warn_within_days: z
        .number()
        .int()
        .default(30)
        .describe("Flag certificates expiring within this many days as 'expiring soon'"),
    },
    async handler(a, ctx) {
      ctx.info("Auditing certificate expiry");
      const text = await executeMikrotikCommand("/certificate print detail", ctx);
      if (looksLikeError(text)) return `Failed to read certificates: ${text}`;
      if (isEmpty(text)) return "No certificates are installed on this device.";

      const warn = a.warn_within_days;
      const certs = parseCertExpiry(text, Date.now()).sort(
        (x, y) => (x.daysLeft ?? Infinity) - (y.daysLeft ?? Infinity),
      );
      if (certs.length === 0) return "No certificates are installed on this device.";

      const expired = certs.filter((c) => c.daysLeft != null && c.daysLeft < 0);
      const soon = certs.filter((c) => c.daysLeft != null && c.daysLeft >= 0 && c.daysLeft <= warn);
      const ok = certs.filter((c) => c.daysLeft != null && c.daysLeft > warn);
      const unknown = certs.filter((c) => c.daysLeft == null);

      const row = (c: (typeof certs)[number]): string => {
        if (c.daysLeft == null) return `  • ${c.name} — no expiry date`;
        if (c.daysLeft < 0)
          return `  • ${c.name} — EXPIRED ${-c.daysLeft}d ago (${c.invalidAfter})`;
        return `  • ${c.name} — ${c.daysLeft}d left (${c.invalidAfter})`;
      };

      const parts: string[] = [
        `CERTIFICATE EXPIRY AUDIT — ${certs.length} certificate(s), warn threshold ${warn}d`,
        "",
      ];
      if (expired.length) parts.push(`⛔ EXPIRED (${expired.length}):`, ...expired.map(row), "");
      if (soon.length) parts.push(`⚠️  EXPIRING SOON (${soon.length}):`, ...soon.map(row), "");
      if (ok.length) parts.push(`✅ OK (${ok.length}):`, ...ok.map(row), "");
      if (unknown.length) parts.push(`❔ NO EXPIRY (${unknown.length}):`, ...unknown.map(row), "");
      if (!expired.length && !soon.length) {
        parts.push("All certificates with an expiry date are valid beyond the warning threshold.");
      }
      return parts.join("\n").trimEnd();
    },
  }),

  defineTool({
    name: "request_letsencrypt_certificate",
    title: "Request/Renew Let's Encrypt Certificate",
    annotations: WRITE,
    description:
      "Obtains (or renews) a free Let's Encrypt TLS certificate for `dns_name` using RouterOS's " +
      "built-in ACME client (`/certificate enable-ssl-certificate`). The device must be reachable " +
      "from the internet on TCP 80 and `dns_name` must already resolve to it (ACME http-01 " +
      "challenge). On success the certificate is installed in the store and bound to the www-ssl " +
      "service; re-running this for the same name renews it. To check what is installed and when it " +
      "expires use audit_certificate_expiry. NOTE: this reaches the public ACME service and may take " +
      "several seconds. Returns the device's output from the request.",
    inputSchema: {
      dns_name: z
        .string()
        .describe("Public DNS name that resolves to this router, e.g. 'vpn.example.com'"),
    },
    async handler(a, ctx) {
      ctx.info(`Requesting Let's Encrypt certificate for ${a.dns_name}`);
      const cmd = new Cmd("/certificate enable-ssl-certificate")
        .set("dns-name", a.dns_name)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) {
        return `Failed to request Let's Encrypt certificate for ${a.dns_name}: ${result}`;
      }
      const body = result.trim() || "(device returned no output)";
      const note =
        "Verify with audit_certificate_expiry once issuance completes (needs public TCP 80 + DNS).";
      return `Let's Encrypt certificate request submitted for '${a.dns_name}'. ${note}\n\n${body}`;
    },
  }),
];
