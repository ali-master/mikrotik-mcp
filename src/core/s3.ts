/**
 * Optional S3-compatible object storage, backed by Bun's native S3 client.
 *
 * The feature is opt-in: when no S3 config is present (`config.s3` is
 * undefined), `isS3Configured()` is false and the S3 backup tools short-circuit
 * with a friendly message instead of throwing. Credentials, bucket and
 * endpoint come from the loaded config (which itself layers env → flags → JSON
 * `s3` block on top of Bun's native `S3_*`/`AWS_*` lookup).
 */
import { S3Client } from "bun";
import type { S3Config } from "../config";
import { getConfig } from "./runtime";

export function getS3Config(): S3Config | undefined {
  return getConfig().s3;
}

/** True when enough S3 settings exist to construct a client. */
export function isS3Configured(): boolean {
  const s3 = getS3Config();
  return !!(s3 && (s3.bucket || s3.endpoint || s3.accessKeyId));
}

/**
 * Build a Bun `S3Client` from the active config. Only defined fields are passed
 * so Bun can still fall back to its native `S3_*`/`AWS_*` env lookup for any
 * value left unset. Throws if S3 is not configured at all.
 */
export function getS3Client(): S3Client {
  const s3 = getS3Config();
  if (!s3 || !isS3Configured()) {
    throw new Error(
      "S3 is not configured. Set S3_* (or AWS_*) environment variables, or add " +
        'an "s3" block to the JSON config file.',
    );
  }
  const opts: Record<string, string> = {};
  if (s3.accessKeyId) opts.accessKeyId = s3.accessKeyId;
  if (s3.secretAccessKey) opts.secretAccessKey = s3.secretAccessKey;
  if (s3.sessionToken) opts.sessionToken = s3.sessionToken;
  if (s3.region) opts.region = s3.region;
  if (s3.endpoint) opts.endpoint = s3.endpoint;
  if (s3.bucket) opts.bucket = s3.bucket;
  return new S3Client(opts);
}

/** Prepend the configured key prefix (if any) to an object name. */
export function s3Key(name: string): string {
  const prefix = getS3Config()?.prefix ?? "";
  if (!prefix) return name;
  return `${prefix.replace(/\/+$/, "")}/${name.replace(/^\/+/, "")}`;
}

/** Configured presigned-URL lifetime in seconds (default 3600). */
export function presignExpiresIn(): number {
  return getS3Config()?.presignExpiresIn ?? 3600;
}

/** A short, human-readable summary of where backups will be stored. */
export function s3Target(): string {
  const s3 = getS3Config();
  if (!s3) return "S3 not configured";
  const where = s3.endpoint ?? "AWS S3";
  const bucket = s3.bucket ?? "(bucket from env)";
  const prefix = s3.prefix ? ` prefix='${s3.prefix}'` : "";
  return `bucket='${bucket}' at ${where}${prefix}`;
}
