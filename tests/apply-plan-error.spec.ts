/**
 * Regression: a failed/rolled-back `apply_plan` must surface as a tool ERROR,
 * not a success. The handler signals failure by THROWING (the registry turns a
 * thrown error into an isError result); the old code returned a plain
 * "apply_plan failed and was rolled back: …" string, which the success/failure
 * backstop didn't catch, so the call was wrongly reported as ok.
 */
import { describe, expect, test } from "vite-plus/test";
import { MikrotikConfigSchema } from "../src/config";
import { createContext } from "../src/core/context";
import { setConfig } from "../src/core/runtime";
import { changePlanTools } from "../src/tools/change-plan";

// 127.0.0.1:1 is closed → Safe Mode can't enable → the apply path fails fast.
setConfig(
  MikrotikConfigSchema.parse({
    devices: { default: { host: "127.0.0.1", port: 1, timeoutMs: 1500 } },
    defaultDevice: "default",
  }),
);

const applyPlan = changePlanTools.find((t) => t.name === "apply_plan");

describe("apply_plan error reporting", () => {
  test("a failed apply rejects (so the registry reports isError), never resolves", async () => {
    expect(applyPlan).toBeDefined();
    let threw = false;
    let result: unknown;
    try {
      result = await applyPlan!.handler(
        { commands: ["/ip address add address=10.10.10.1/24 interface=bridge"], confirm: false },
        createContext(),
      );
    } catch {
      threw = true;
    }
    // The device is unreachable, so this MUST be an error (thrown), not a
    // success-looking string returned to the model.
    expect(threw).toBe(true);
    expect(result).toBeUndefined();
  });

  test("empty command list is a benign no-op (ok), not an error", async () => {
    const out = await applyPlan!.handler({ commands: [], confirm: false }, createContext());
    expect(typeof out === "string" ? out : out.text).toMatch(/No commands provided/);
  });
});
