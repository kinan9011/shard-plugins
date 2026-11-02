import { vi } from "vitest";
import type { ShardSdk } from "../src/shard-sdk";

/** A fake host: copies resolve (or use `writeText`), and `storage` is an in-memory map the test can read and seed. */
export function fakeSdk(writeText: (text: string) => Promise<void> = async () => {}, initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const sdk = {
    toast: vi.fn(async () => {}),
    clipboard: { writeText: vi.fn(writeText) },
    storage: {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: unknown) => void store.set(key, value),
      remove: async (key: string) => void store.delete(key),
    },
  } as unknown as ShardSdk;
  return { sdk, store };
}
