/**
 * Offline test for the file-upload guard. The real SFTP transfer needs a live
 * SSH server, but the MAC-Telnet rejection is pure logic (it throws before any
 * network) — so we lock that: a Layer-2 device must be refused with an
 * actionable message rather than silently failing or attempting SFTP.
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { MikrotikConfigSchema } from "../src/config";
import { uploadFileToDevice } from "../src/core/connector";
import { getConfig, setConfig } from "../src/core/runtime";

const original = getConfig();
afterEach(() => setConfig(original));

describe("uploadFileToDevice", () => {
  test("refuses a MAC-Telnet device (no file transport over Layer-2)", async () => {
    setConfig(
      MikrotikConfigSchema.parse({
        defaultDevice: "l2",
        devices: { l2: { mac: "48:8F:5A:11:22:33", username: "admin" } },
      }),
    );
    await expect(uploadFileToDevice("l2", "config.rsc", Buffer.from("x"))).rejects.toThrow(
      /MAC-Telnet/i,
    );
  });
});
