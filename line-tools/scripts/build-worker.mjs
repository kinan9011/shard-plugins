// Bundles the regex worker into public/regex-worker.js. The sandboxed frame cannot start a worker from
// `new URL(..., import.meta.url)`; regex-runner.ts starts this file with the SDK's spawnWorker().
import { build } from "esbuild";

await build({
  entryPoints: ["src/utils/regex.worker.ts"],
  outfile: "public/regex-worker.js",
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
});
