/**
 * Connector error-surfacing test.
 *
 * A transport/connection failure must *throw* (so the registry marks the tool
 * result as an error) — it must NOT come back as a string that a tool then wraps
 * in a success message like "INTERFACES:\n\nError: …".
 */
import { describe, expect, test } from "vite-plus/test";
import { MikrotikConfigSchema } from "../src/config";
import { executeMikrotikCommand } from "../src/core/connector";
import { createContext } from "../src/core/context";
import { setConfig } from "../src/core/runtime";
import { interfaceTools } from "../src/tools/interfaces";

// 127.0.0.1:1 is closed -> ECONNREFUSED is immediate (no waiting on the timeout).
function pointAtClosedPort() {
  setConfig(
    MikrotikConfigSchema.parse({
      devices: { default: { host: "127.0.0.1", port: 1, timeoutMs: 1500 } },
      defaultDevice: "default",
    }),
  );
}

describe("connector error handling", () => {
  test("a connection failure throws with an actionable message", async () => {
    pointAtClosedPort();
    // Await the real Promise and assert on the caught error. (Bun types
    // `expect().rejects.toThrow()` as returning `void`, which trips the
    // type-aware await-thenable rule even though it resolves a Promise.)
    let error: Error | undefined;
    try {
      await executeMikrotikCommand("/interface print", createContext());
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(
      /Failed to connect to MikroTik device 'default' at 127\.0\.0\.1:1/,
    );
    expect(error?.message).toMatch(/auth: no credentials/);
  });

  test("list_interfaces does NOT return connection errors as success text", async () => {
    pointAtClosedPort();
    const listInterfaces = interfaceTools.find((t) => t.name === "list_interfaces")!;
    // Drive the tool through the registry wrapper and capture the protocol result.
    let result: any;
    const fakeServer = {
      registerTool: (_name: string, _cfg: unknown, cb: (args: any) => Promise<any>) => {
        result = cb;
      },
    };
    listInterfaces.register(fakeServer as never);
    const res = await result({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Failed to connect/);
    // The bug symptom — a success-looking "INTERFACES:" header — must be gone.
    expect(res.content[0].text).not.toMatch(/^INTERFACES:/);
  });
});
