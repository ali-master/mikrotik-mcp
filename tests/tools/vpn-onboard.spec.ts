/**
 * Unit test for the WireGuard keypair generator (X25519 via node:crypto).
 */
import { describe, expect, test } from "vite-plus/test";
import { generateWireGuardKeypair } from "../../src/tools/vpn-onboard";

describe("generateWireGuardKeypair", () => {
  test("produces distinct base64 keys that decode to 32 bytes", () => {
    const { privateKey, publicKey } = generateWireGuardKeypair();
    // WireGuard keys are base64 of 32 raw bytes → 44 chars ending in '='.
    expect(privateKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(publicKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(Buffer.from(privateKey, "base64")).toHaveLength(32);
    expect(Buffer.from(publicKey, "base64")).toHaveLength(32);
    expect(privateKey).not.toBe(publicKey);
  });
  test("each call yields a fresh keypair", () => {
    expect(generateWireGuardKeypair().privateKey).not.toBe(generateWireGuardKeypair().privateKey);
  });
});
