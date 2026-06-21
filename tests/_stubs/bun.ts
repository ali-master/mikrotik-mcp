/**
 * Stub for the `bun` module under the Vitest (Node) runner.
 *
 * The server is Bun-native, so a couple of source modules import from `"bun"`
 * (`S3Client`, `serve`). Vitest runs on Node, where `"bun"` doesn't resolve, so
 * `vitest.config.ts` aliases it here. The unit tests never invoke these — they
 * only need the modules that import them to load — so the stubs are inert.
 */
export class S3Client {
  presign(): string {
    return "";
  }
  file(): unknown {
    return {};
  }
  list(): Promise<{ contents: unknown[] }> {
    return Promise.resolve({ contents: [] });
  }
  exists(): Promise<boolean> {
    return Promise.resolve(false);
  }
  stat(): Promise<unknown> {
    return Promise.resolve({});
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
  write(): Promise<number> {
    return Promise.resolve(0);
  }
}

export function serve(_opts?: unknown): unknown {
  return {};
}
