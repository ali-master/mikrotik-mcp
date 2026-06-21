import { defineConfig } from "vite-plus";

/**
 * Vitest config for the unit tests (run via `vp test`, the vite-plus toolchain).
 *
 * Unit tests use the `*.spec.ts` suffix; the legacy `bun:test` smoke suites use
 * `*.test.ts` and run under `bun test`. Keeping the two suffixes apart lets each
 * runner own its files without the other tripping over foreign imports.
 */
export default defineConfig({
  test: {
    include: ["**/*.spec.ts"],
    environment: "node",
    globals: false,
  },
});
