import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";

// Packs dist/ (run `vite build` first, `npm run build` does both) into the package Shard installs:
//   release/<id>-<version>.zip         the files of dist/ at the top level
//   release/<id>-<version>.zip.sha256  "<sha-256>  <file name>", the checksum the repository index lists
// The zip is the same bytes for the same files on any machine (fixed file times, sorted entries).

const dist = path.resolve("dist");
const manifestFile = path.join(dist, "plugin.json");
if (!fs.existsSync(manifestFile)) {
  console.error("Pack failed: dist/plugin.json is missing. Keep plugin.json in public/ so the build copies it.");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(manifest.id ?? "") || typeof manifest.version !== "string") {
  console.error("Pack failed: plugin.json needs an id (lowercase letters, digits and dashes) and a version.");
  process.exit(1);
}
if (!fs.existsSync(path.join(dist, manifest.entry ?? "index.html"))) {
  console.error(`Pack failed: the entry ${manifest.entry} is not in dist/.`);
  process.exit(1);
}
const own = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (own.version !== manifest.version) {
  console.error(`Pack failed: package.json says ${own.version} but plugin.json says ${manifest.version}. Set both to the same version.`);
  process.exit(1);
}

const files = {};
const walk = (dir, prefix) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
    else if (entry.isFile()) files[`${prefix}${entry.name}`] = fs.readFileSync(path.join(dir, entry.name));
  }
};
walk(dist, "");

// Local midnight, so the DOS time fields are the same in every time zone.
const bytes = zipSync(files, { mtime: new Date(2000, 0, 1, 0, 0, 0) });
const name = `${manifest.id}-${manifest.version}.zip`;
fs.mkdirSync("release", { recursive: true });
fs.writeFileSync(path.join("release", name), bytes);
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
fs.writeFileSync(path.join("release", `${name}.sha256`), `${sha256}  ${name}\n`);
console.log(`Packed release/${name} (${bytes.length} bytes)\nsha256 ${sha256}`);
