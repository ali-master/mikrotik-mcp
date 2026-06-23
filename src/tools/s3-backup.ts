/**
 * S3 backup transfer — optional, opt-in.
 *
 * Moves backup/export files between the device and an S3-compatible bucket.
 * The actual byte transfer is performed by the device's own `/tool fetch`
 * against a short-lived presigned URL (so large/binary backups stream straight
 * from the router to S3 without passing through this process), while the Bun
 * native S3 client handles presigning, listing, stat and deletion server-side.
 *
 * Every tool degrades gracefully: if S3 is not configured they return a clear
 * message instead of failing.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { deviceDateStamp } from "../core/datestamp";
import { WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, Cmd } from "../core/routeros";
import { resolveDeviceName } from "../core/runtime";
import {
  s3Target,
  s3Key,
  s3DevicePrefix,
  presignExpiresIn,
  isS3Configured,
  getS3Client,
} from "../core/s3";

const NOT_CONFIGURED =
  "S3 is not configured. Set S3_* (or AWS_*) environment variables, or add an " +
  '"s3" block to the JSON config file, to enable S3 backup transfer.';

/** RouterOS `/tool fetch` reports `status: finished` on success. */
function fetchSucceeded(output: string): boolean {
  return /status:\s*finished/i.test(output);
}

export const s3BackupTools: ToolModule = [
  defineTool({
    name: "s3_backup_status",
    title: "S3 Backup Status",
    annotations: READ,
    description:
      "Reports whether optional S3 backup storage is configured and where " +
      "backups will be stored.",
    async handler(_a, ctx) {
      ctx.info("Checking S3 backup status");
      if (!isS3Configured()) return `S3 backup storage is DISABLED.\n\n${NOT_CONFIGURED}`;
      return `S3 backup storage is ENABLED.\n\nTarget: ${s3Target()}`;
    },
  }),

  defineTool({
    name: "upload_backup_to_s3",
    title: "Upload Backup to S3",
    annotations: WRITE,
    description:
      "Uploads a file from the device (e.g. a .backup or .rsc export) to the " +
      "configured S3 bucket. The device streams it directly to S3 via a " +
      "short-lived presigned URL.\n\n" +
      "Notes:\n" +
      "    filename: the file on the device, e.g. 'daily.backup'.\n" +
      "    key: optional S3 object key; defaults to '<prefix>/<device>/" +
      "<device-datetime>-<filename>' so each upload is organised per router and " +
      "stamped with the DEVICE's local date-time (Jalali calendar in Tehran, " +
      "Gregorian elsewhere) — so repeat uploads version instead of overwriting.",
    inputSchema: {
      filename: z.string().describe("File on the device, e.g. 'daily.backup'"),
      key: z
        .string()
        .optional()
        .describe("S3 object key (defaults to prefix + device-local datetime + filename)"),
      expires_in: z.number().int().min(60).optional().describe("Presigned-URL lifetime in seconds"),
    },
    async handler(a, ctx) {
      if (!isS3Configured()) return NOT_CONFIGURED;
      const key =
        a.key ??
        s3Key(`${await deviceDateStamp(ctx)}-${a.filename}`, resolveDeviceName(ctx.device));
      ctx.info(`Uploading '${a.filename}' to S3 key '${key}'`);

      // Ensure the source file exists on the device first.
      const count = await executeMikrotikCommand(
        `/file print count-only where name=${a.filename}`,
        ctx,
      );
      if (count.trim() === "0") return `File '${a.filename}' not found on the device.`;

      let url: string;
      try {
        url = getS3Client().presign(key, {
          method: "PUT",
          expiresIn: a.expires_in ?? presignExpiresIn(),
        });
      } catch (e) {
        return `Failed to presign S3 upload URL: ${e instanceof Error ? e.message : String(e)}`;
      }

      // The device PUTs the file body directly to the presigned URL. NOTE: do
      // NOT pass `mode=` here — a full `url=` already implies the scheme, and
      // adding `mode` flips RouterOS into its legacy address/src-path parsing
      // where `src-path` is read as a *remote* path, colliding with the URL's
      // path ("failure: Conflicting remote paths provided in URI and parameter").
      // With url + http-method=put, `src-path` is correctly the local source file.
      const cmd = new Cmd("/tool fetch")
        .set("url", url)
        .set("http-method", "put")
        .set("src-path", a.filename)
        .set("output", "none")
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);

      if (looksLikeError(result) || !fetchSucceeded(result))
        return `Failed to upload '${a.filename}' to S3 (key '${key}'):\n\n${result}`;
      return `Uploaded '${a.filename}' to S3 key '${key}' (${s3Target()}).`;
    },
  }),

  defineTool({
    name: "download_backup_from_s3",
    title: "Download Backup from S3",
    annotations: WRITE,
    description:
      "Downloads an object from the configured S3 bucket onto the device " +
      "filesystem (e.g. to later restore a backup). The device streams it " +
      "directly from S3 via a short-lived presigned URL.\n\n" +
      "Notes:\n" +
      "    key: the S3 object key to download.\n" +
      "    filename: optional device destination; defaults to the key's base " +
      "name.",
    inputSchema: {
      key: z.string().describe("S3 object key to download"),
      filename: z
        .string()
        .optional()
        .describe("Device destination filename (defaults to the key basename)"),
      expires_in: z.number().int().min(60).optional().describe("Presigned-URL lifetime in seconds"),
    },
    async handler(a, ctx) {
      if (!isS3Configured()) return NOT_CONFIGURED;
      const filename = a.filename ?? a.key.split("/").pop() ?? a.key;
      ctx.info(`Downloading S3 key '${a.key}' to device file '${filename}'`);

      let url: string;
      try {
        url = getS3Client().presign(a.key, {
          method: "GET",
          expiresIn: a.expires_in ?? presignExpiresIn(),
        });
      } catch (e) {
        return `Failed to presign S3 download URL: ${e instanceof Error ? e.message : String(e)}`;
      }

      // No `mode=`: the full `url=` already implies the scheme (passing a
      // conflicting/redundant mode triggers RouterOS "Conflicting ... in URI and
      // parameter"). `dst-path` is the local destination on the device.
      const cmd = new Cmd("/tool fetch").set("url", url).set("dst-path", filename).build();
      const result = await executeMikrotikCommand(cmd, ctx);

      if (looksLikeError(result) || !fetchSucceeded(result))
        return `Failed to download S3 key '${a.key}' to '${filename}':\n\n${result}`;
      return `Downloaded S3 key '${a.key}' to device file '${filename}'.`;
    },
  }),

  defineTool({
    name: "list_s3_backups",
    title: "List S3 Backups",
    annotations: READ,
    description:
      "Lists objects in the configured S3 bucket. By default lists only the " +
      "current device's backups (under '<prefix>/<device>/'); pass an explicit " +
      "prefix to list elsewhere (e.g. '' for the whole bucket).",
    inputSchema: {
      prefix: z
        .string()
        .optional()
        .describe("Key prefix to list under (defaults to this device's '<prefix>/<device>/')"),
      max_keys: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(100)
        .describe("Maximum number of objects to return (1-1000)"),
    },
    async handler(a, ctx) {
      if (!isS3Configured()) return NOT_CONFIGURED;
      const prefix = a.prefix ?? s3DevicePrefix(resolveDeviceName(ctx.device));
      ctx.info(`Listing S3 objects (prefix='${prefix}')`);
      try {
        const res = await getS3Client().list({
          prefix: prefix || undefined,
          maxKeys: a.max_keys,
        });
        const items = res.contents ?? [];
        if (items.length === 0) return "No S3 objects found matching the criteria.";
        const lines = items.map(
          (o) => `${o.key}  (${o.size ?? "?"} bytes, modified ${o.lastModified ?? "?"})`,
        );
        const more = res.isTruncated ? "\n\n(more results available)" : "";
        return `S3 OBJECTS (${s3Target()}):\n\n${lines.join("\n")}${more}`;
      } catch (e) {
        return `Failed to list S3 objects: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  defineTool({
    name: "s3_backup_info",
    title: "S3 Backup Info",
    annotations: READ,
    description:
      "Gets metadata (size, etag, last-modified, content type) for an object " +
      "in the configured S3 bucket.",
    inputSchema: {
      key: z.string().describe("S3 object key"),
    },
    async handler(a, ctx) {
      if (!isS3Configured()) return NOT_CONFIGURED;
      ctx.info(`Getting S3 object info: key='${a.key}'`);
      try {
        const client = getS3Client();
        if (!(await client.exists(a.key))) return `S3 object '${a.key}' not found.`;
        const stat = await client.stat(a.key);
        return (
          `S3 OBJECT '${a.key}':\n\n` +
          `size: ${stat.size} bytes\n` +
          `type: ${stat.type}\n` +
          `etag: ${stat.etag}\n` +
          `lastModified: ${stat.lastModified.toISOString()}`
        );
      } catch (e) {
        return `Failed to stat S3 object '${a.key}': ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  defineTool({
    name: "delete_s3_backup",
    title: "Delete S3 Backup",
    annotations: DESTRUCTIVE,
    description: "Deletes an object from the configured S3 bucket.",
    inputSchema: {
      key: z.string().describe("S3 object key to delete"),
    },
    async handler(a, ctx) {
      if (!isS3Configured()) return NOT_CONFIGURED;
      ctx.info(`Deleting S3 object: key='${a.key}'`);
      try {
        const client = getS3Client();
        if (!(await client.exists(a.key))) return `S3 object '${a.key}' not found.`;
        await client.delete(a.key);
        return `S3 object '${a.key}' deleted successfully.`;
      } catch (e) {
        return `Failed to delete S3 object '${a.key}': ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),
];
