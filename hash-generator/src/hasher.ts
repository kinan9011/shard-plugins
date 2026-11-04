import { formatNumber } from "./lib/i18n";

/** The algorithm numbers of wasm/src/lib.rs. */
export const HASH_TYPES = [
  { type: "md5", label: "MD5", algo: 0 },
  { type: "sha1", label: "SHA-1", algo: 1 },
  { type: "sha256", label: "SHA-256", algo: 2 },
  { type: "sha384", label: "SHA-384", algo: 3 },
  { type: "sha512", label: "SHA-512", algo: 4 },
  { type: "sha3-256", label: "SHA-3-256", algo: 5 },
  { type: "sha3-512", label: "SHA-3-512", algo: 6 },
  { type: "keccak256", label: "Keccak-256", algo: 7 },
] as const;

export const HMAC_TYPES = [
  { type: "sha256", label: "HMAC-SHA256", algo: 2 },
  { type: "sha384", label: "HMAC-SHA384", algo: 3 },
  { type: "sha512", label: "HMAC-SHA512", algo: 4 },
] as const;

export type Results = Record<string, string>;

export interface Hasher {
  /** The hash of `bytes` for every entry of HASH_TYPES, as lowercase hex. */
  hashAll(bytes: Uint8Array): Results;
  /** The HMAC of `bytes` under `key` for every entry of HMAC_TYPES. */
  hmacAll(bytes: Uint8Array, key: Uint8Array): Results;
}

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  digest_into(algo: number, input: number, len: number, output: number): number;
  hmac_into(algo: number, key: number, keyLen: number, input: number, len: number, output: number): number;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

// ponytail: runs on the page's main thread. Hashing a file of tens of MB blocks the UI for a moment;
// move `call` into a worker (see plugins/examples/hash-wasm in the shard repo) if that is ever noticed.
export function createHasher(instance: WebAssembly.Instance): Hasher {
  const wasm = instance.exports as unknown as Exports;

  /** Copies each part into linear memory, runs `run` with the pointers and an output block, and frees everything. */
  function call(parts: Uint8Array[], run: (pointers: number[], output: number) => number): string {
    const pointers = parts.map((part) => wasm.alloc(part.length));
    const output = wasm.alloc(64);
    try {
      // Read memory.buffer after every alloc: growing the memory replaces the buffer.
      parts.forEach((part, index) => new Uint8Array(wasm.memory.buffer, pointers[index], part.length).set(part));
      const length = run(pointers, output);
      return toHex(new Uint8Array(wasm.memory.buffer, output, length).slice());
    } finally {
      parts.forEach((part, index) => wasm.dealloc(pointers[index], part.length));
      wasm.dealloc(output, 64);
    }
  }

  return {
    hashAll: (bytes) =>
      Object.fromEntries(HASH_TYPES.map(({ type, algo }) => [type, call([bytes], ([input], output) => wasm.digest_into(algo, input, bytes.length, output))])),
    hmacAll: (bytes, key) =>
      Object.fromEntries(HMAC_TYPES.map(({ type, algo }) => [type, call([key, bytes], ([keyPtr, input], output) => wasm.hmac_into(algo, keyPtr, key.length, input, bytes.length, output))])),
  };
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = value >= 10 ? 1 : 2;
  return `${formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[i]}`;
}
