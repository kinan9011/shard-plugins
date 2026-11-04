import fs from "node:fs";
import { build } from "esbuild";

// Keep source copies so the plugin also builds without its parent repository.
for (const name of ["shard-sdk.ts", "sdk.ts", "bootstrap.tsx", "storage-shim.ts", "hooks/useToolActive.ts", "lib/i18n.ts", "lib/i18n-common.ts"]) {
  if (fs.existsSync(`../shared/${name}`)) {
    fs.mkdirSync(`src/${name.split("/").slice(0, -1).join("/")}`, { recursive: true });
    fs.copyFileSync(`../shared/${name}`, `src/${name}`);
  }
}
if (fs.existsSync("../shared/template/scripts/pack.mjs")) fs.copyFileSync("../shared/template/scripts/pack.mjs", "scripts/pack.mjs");
await build({ entryPoints: ["src/pdf/engine.worker.ts"], outfile: "public/pdf-engine.js", bundle: true, format: "iife", target: "es2020", minify: true });
await build({ entryPoints: ["node_modules/pdfjs-dist/build/pdf.worker.mjs"], outfile: "public/pdf-preview.js", bundle: true, format: "iife", target: "es2022", minify: true });
for (const folder of ["cmaps", "standard_fonts"]) fs.cpSync(`node_modules/pdfjs-dist/${folder}`, `public/pdf-assets/${folder}`, { recursive: true });
fs.mkdirSync("public/licenses", { recursive: true });
for (const [name, file] of [["pdfjs-dist", "LICENSE"], ["pdf-lib", "LICENSE.md"], ["fflate", "LICENSE"]]) fs.copyFileSync(`node_modules/${name}/${file}`, `public/licenses/${name}.txt`);
