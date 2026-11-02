/**
 * Where the WASM codecs get their bytes (plugin version of the app, which imports them with `?url`).
 *
 * The codecs sit in the plugin's public/ folder (scripts/build-worker.mjs copies them from
 * node_modules). The page fetches them. The encode worker runs from a Blob URL, so it cannot
 * resolve a relative URL: the page sends it the bytes it needs, and the worker calls provideWasm.
 */
import type { ProcessOptions } from "./image-process";

export type WasmName =
  | "avif_enc.wasm"
  | "mozjpeg_enc.wasm"
  | "webp_enc.wasm"
  | "squoosh_oxipng_bg.wasm"
  | "squoosh_resize_bg.wasm";

const ENCODER_FILE = {
  avif: "avif_enc.wasm",
  jpeg: "mozjpeg_enc.wasm",
  webp: "webp_enc.wasm",
  png: "squoosh_oxipng_bg.wasm",
} as const satisfies Record<ProcessOptions["format"], WasmName>;

/** The codec files one encode needs. */
export const wasmNeeded = (options: Pick<ProcessOptions, "format" | "resize">): WasmName[] => [
  ENCODER_FILE[options.format],
  ...(options.resize ? (["squoosh_resize_bg.wasm"] as const) : []),
];

const bytes = new Map<string, Promise<ArrayBuffer>>();

/** Hands the worker the bytes the page fetched. */
export const provideWasm = (files: Record<string, ArrayBuffer>) => {
  for (const [name, data] of Object.entries(files)) bytes.set(name, Promise.resolve(data));
};

/** The bytes of one codec file. On the page this fetches the file next to index.html, once. */
export const wasmBytes = (name: WasmName): Promise<ArrayBuffer> => {
  let found = bytes.get(name);
  if (!found) {
    found = fetch(new URL(name, location.href).href).then((response) => {
      if (!response.ok) throw new Error(`Could not load ${name}: ${response.status}`);
      return response.arrayBuffer();
    });
    // A failed load must not stay cached.
    found.catch(() => bytes.delete(name));
    bytes.set(name, found);
  }
  return found;
};
