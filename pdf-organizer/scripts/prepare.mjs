import fs from "node:fs";
import { build } from "esbuild";

// Source copies stay in the plugin so release builds work from this folder alone.
if (fs.existsSync("../shared/pdf/limits.ts")) fs.copyFileSync("../shared/pdf/limits.ts", "src/pdf/limits.ts");
await build({ entryPoints: ["src/pdf/engine.worker.ts"], outfile: "public/pdf-engine.js", bundle: true, format: "iife", target: "es2020", minify: true });
// Classic workers work from blob URLs in opaque-origin frames; module workers may fail to start.
await build({ entryPoints: ["node_modules/pdfjs-dist/build/pdf.worker.mjs"], outfile: "public/pdf-preview.js", bundle: true, format: "iife", target: "es2022", minify: true });
for (const folder of ["cmaps", "standard_fonts"]) {
  fs.cpSync(`node_modules/pdfjs-dist/${folder}`, `public/pdf-assets/${folder}`, { recursive: true });
}
fs.mkdirSync("public/licenses", { recursive: true });
for (const [name, file] of [["pdfjs-dist", "LICENSE"], ["pdf-lib", "LICENSE.md"], ["fflate", "LICENSE"]]) {
  fs.copyFileSync(`node_modules/${name}/${file}`, `public/licenses/${name}.txt`);
}
