/**
 * Offline tests for the optional S3 configuration + helper. No network or real
 * bucket is touched; these validate config layering and the opt-in behaviour.
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { loadConfig, MikrotikConfigSchema } from "../src/config";
import { setConfig } from "../src/core/runtime";
import {
  isS3Configured,
  s3Key,
  s3DevicePrefix,
  presignExpiresIn,
  getS3Config,
} from "../src/core/s3";

const S3_ENV_KEYS = [
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_SESSION_TOKEN",
  "S3_REGION",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "AWS_ENDPOINT",
  "AWS_BUCKET",
  "MIKROTIK_S3_PREFIX",
  "MIKROTIK_S3_PRESIGN_EXPIRES_IN",
];

function clearS3Env(): void {
  for (const k of S3_ENV_KEYS) delete process.env[k];
}

afterEach(() => {
  clearS3Env();
  // Reset runtime config so helper-based tests don't leak across cases.
  setConfig(MikrotikConfigSchema.parse({}));
});

describe("S3 config loading", () => {
  test("absent by default — feature stays opt-in", () => {
    clearS3Env();
    const cfg = loadConfig([]);
    expect(cfg.s3).toBeUndefined();
    setConfig(cfg);
    expect(isS3Configured()).toBe(false);
  });

  test("reads S3_* environment variables", () => {
    clearS3Env();
    process.env.S3_BUCKET = "my-backups";
    process.env.S3_ACCESS_KEY_ID = "AKIAEXAMPLE";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.MIKROTIK_S3_PREFIX = "mikrotik/";
    const cfg = loadConfig([]);
    expect(cfg.s3?.bucket).toBe("my-backups");
    expect(cfg.s3?.accessKeyId).toBe("AKIAEXAMPLE");
    expect(cfg.s3?.prefix).toBe("mikrotik/");
    setConfig(cfg);
    expect(isS3Configured()).toBe(true);
  });

  test("falls back to AWS_* environment variables", () => {
    clearS3Env();
    process.env.AWS_BUCKET = "aws-backups";
    process.env.AWS_REGION = "eu-central-1";
    const cfg = loadConfig([]);
    expect(cfg.s3?.bucket).toBe("aws-backups");
    expect(cfg.s3?.region).toBe("eu-central-1");
  });

  test("flags override env", () => {
    clearS3Env();
    process.env.S3_BUCKET = "env-bucket";
    const cfg = loadConfig(["--s3-bucket", "flag-bucket"]);
    expect(cfg.s3?.bucket).toBe("flag-bucket");
  });

  test("endpoint alone marks S3 configured (R2/MinIO via env creds)", () => {
    clearS3Env();
    process.env.S3_ENDPOINT = "http://localhost:9000";
    const cfg = loadConfig([]);
    setConfig(cfg);
    expect(isS3Configured()).toBe(true);
  });
});

describe("S3 helper", () => {
  test("s3Key joins the prefix and trims slashes", () => {
    setConfig(MikrotikConfigSchema.parse({ s3: { bucket: "b", prefix: "mikrotik/" } }));
    expect(s3Key("daily.backup")).toBe("mikrotik/daily.backup");
    expect(s3Key("/daily.backup")).toBe("mikrotik/daily.backup");
  });

  test("s3Key categorises by device", () => {
    setConfig(MikrotikConfigSchema.parse({ s3: { bucket: "b", prefix: "mikrotik/" } }));
    expect(s3Key("daily.backup", "home")).toBe("mikrotik/home/daily.backup");
    expect(s3DevicePrefix("home")).toBe("mikrotik/home/");
    // Device categorisation works even without a configured prefix.
    setConfig(MikrotikConfigSchema.parse({ s3: { bucket: "b" } }));
    expect(s3Key("daily.backup", "edge")).toBe("edge/daily.backup");
    expect(s3DevicePrefix("edge")).toBe("edge/");
  });

  test("s3Key is a no-op without a prefix or device", () => {
    setConfig(MikrotikConfigSchema.parse({ s3: { bucket: "b" } }));
    expect(s3Key("daily.backup")).toBe("daily.backup");
    expect(s3DevicePrefix()).toBe("");
  });

  test("presignExpiresIn defaults to 3600", () => {
    setConfig(MikrotikConfigSchema.parse({ s3: { bucket: "b" } }));
    expect(presignExpiresIn()).toBe(3600);
    expect(getS3Config()?.bucket).toBe("b");
  });
});
