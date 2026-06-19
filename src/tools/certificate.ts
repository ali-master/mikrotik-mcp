/** Certificates — `/certificate`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE,  READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type {ToolModule} from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const certificateTools: ToolModule = [
  defineTool({
    name: "list_certificates",
    title: "List Certificates",
    annotations: READ,
    description: "Lists certificates in the MikroTik device's certificate store.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing certificates");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(`/certificate print${whereClause(filters)}`, ctx);
      return isEmpty(result) ? "No certificates found matching the criteria." : `CERTIFICATES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_certificate",
    title: "Get Certificate",
    annotations: READ,
    description: "Gets detailed information about a specific certificate.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting certificate details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/certificate print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result) ? `Certificate '${a.name}' not found.` : `CERTIFICATE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "create_certificate",
    title: "Create Certificate",
    annotations: WRITE,
    description:
      "Creates a certificate template on the MikroTik device. Use sign_certificate to self-sign it after creating.",
    inputSchema: {
      name: z.string().describe("Name for the certificate"),
      common_name: z.string().describe("Common name (CN), e.g. a hostname or domain"),
      key_size: z.number().int().default(2048).describe("RSA key size in bits"),
      days_valid: z.number().int().default(365).describe("Validity period in days"),
      key_usage: z.string().optional().describe("Comma-separated key usages, e.g. 'tls-server'"),
      country: z.string().optional().describe("Country code (C), e.g. 'US'"),
      organization: z.string().optional().describe("Organization (O)"),
    },
    async handler(a, ctx) {
      ctx.info(`Creating certificate: name=${a.name}`);
      const cmd = new Cmd("/certificate add")
        .set("name", a.name)
        .set("common-name", a.common_name)
        .opt("key-size", a.key_size)
        .opt("days-valid", a.days_valid)
        .opt("key-usage", a.key_usage)
        .opt("country", a.country)
        .opt("organization", a.organization)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create certificate: ${result}`;

      const details = await executeMikrotikCommand(
        `/certificate print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `Certificate created successfully:\n\n${details}`
        : "Certificate creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "sign_certificate",
    title: "Sign Certificate",
    annotations: WRITE,
    description:
      "Signs a certificate on the MikroTik device (self-sign or sign with a CA). This may be long-running.",
    inputSchema: {
      name: z.string().describe("Name of the certificate to sign"),
      ca: z.string().optional().describe("Name of the CA certificate to sign with (omit to self-sign)"),
      common_name: z.string().optional().describe("Override the common name when signing"),
    },
    async handler(a, ctx) {
      ctx.info(`Signing certificate: name=${a.name}`);
      const cmd = new Cmd("/certificate sign")
        .raw(a.name)
        .opt("ca", a.ca)
        .opt("common-name", a.common_name)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to sign certificate: ${result}`;
      return `Signing certificate '${a.name}'...\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_certificate",
    title: "Remove Certificate",
    annotations: DESTRUCTIVE,
    description: "Removes a certificate from the MikroTik device's certificate store.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing certificate: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/certificate print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `Certificate '${a.name}' not found.`;

      const result = await executeMikrotikCommand(`/certificate remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to remove certificate: ${result}`;
      return `Certificate '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "import_certificate",
    title: "Import Certificate",
    annotations: WRITE,
    description: "Imports a certificate or key from a file in the MikroTik device's file system.",
    inputSchema: {
      file_name: z.string().describe("Name of the certificate/key file to import"),
      passphrase: z.string().optional().describe("Passphrase protecting the imported key, if any"),
      name: z.string().optional().describe("Name to assign to the imported certificate"),
    },
    async handler(a, ctx) {
      ctx.info(`Importing certificate from file: ${a.file_name}`);
      const cmd = new Cmd("/certificate import")
        .set("file-name", a.file_name)
        .opt("passphrase", a.passphrase)
        .opt("name", a.name)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to import certificate: ${result}`;
      return `Certificate import completed:\n\n${result}`;
    },
  }),
];
