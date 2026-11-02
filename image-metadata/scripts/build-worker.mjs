// Bundles the encode worker into public/image-encode-worker.js and copies the WASM codecs into public/.
// The sandboxed frame cannot start a worker from `new URL(..., import.meta.url)` or import `.wasm?url`:
// image-reencode.ts starts the bundled file with the SDK's spawnWorker(), and wasm-source.ts loads the codec files.
import fs from "node:fs";
import { build } from "esbuild";

await build({
  entryPoints: ["src/utils/image-encode.worker.ts"],
  outfile: "public/image-encode-worker.js",
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  // The codecs' glue only touches import.meta.url on paths this plugin never takes (it passes wasmBinary).
  define: { "import.meta.url": "self.location.href" },
  logLevel: "warning",
});

const codecs = {
  "avif_enc.wasm": "@jsquash/avif/codec/enc/avif_enc.wasm",
  "mozjpeg_enc.wasm": "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm",
  "webp_enc.wasm": "@jsquash/webp/codec/enc/webp_enc.wasm",
  "squoosh_oxipng_bg.wasm": "@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm",
  "squoosh_resize_bg.wasm": "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm",
};
for (const [name, from] of Object.entries(codecs)) fs.copyFileSync(`node_modules/${from}`, `public/${name}`);
