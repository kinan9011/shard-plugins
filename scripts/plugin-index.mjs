import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

// Builds or updates a plugin repository's index.json from a folder of built plugin zips
// (the output of the template's `npm run build`, one `<id>-<version>.zip` per plugin).
//
// Usage: node scripts/plugin-index.mjs --zips <dir> --base-url <url> [--index index.json]
//                                      [--name <repo name>] [--date YYYY-MM-DD]
//
// - `--base-url` is where the zips will be downloadable; each entry's `url` is `<base-url>/<zip name>`.
// - Entries of plugins that are not in `--zips`, and the index's name and `bundles`, are kept.
// - A plugin's version has to be newer than the listed one, so a forgotten version bump fails here
//   instead of swapping a package under an unchanged version. The same zip again only refreshes its entry.
// - A zip is named `<id>-<version>.zip`. A `<zip>.sha256` file next to a zip is checked against the zip.
// - No dependencies: the workflow in the plugins repository runs this without installing anything.
// The index format is documented in docs/plugins/index-format.md.

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const RUNTIMES = ["web", "wasm", "web+wasm"];
const MAX_MANIFEST_BYTES = 1024 * 1024;

class UsageError extends Error {}

function fail(message) {
  console.error(`Plugin index failed: ${message}`);
  process.exit(1);
}

// --- semver ordering (semver.org section 11) --------------------------------------------------

export function compareVersions(a, b) {
  const [, ...pa] = SEMVER.exec(a);
  const [, ...pb] = SEMVER.exec(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return Number(pa[i]) < Number(pb[i]) ? -1 : 1;
  }
  const [preA, preB] = [pa[3]?.split("."), pb[3]?.split(".")];
  if (!preA || !preB) return preA === preB ? 0 : preA ? -1 : 1; // a release is newer than its prereleases
  for (let i = 0; i < Math.max(preA.length, preB.length); i++) {
    const [x, y] = [preA[i], preB[i]];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const [nx, ny] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1; // numeric identifiers sort before alphanumeric ones
    return x < y ? -1 : 1;
  }
  return 0;
}

// --- a small zip reader (central directory; stored and deflated entries) ----------------------

function readZipEntries(buffer) {
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= lowest; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new UsageError("not a zip file");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new UsageError("zip64 archives are not supported");
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new UsageError("damaged zip directory");
    const flags = buffer.readUInt16LE(offset + 8);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, {
      encrypted: (flags & 1) !== 0,
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      size: buffer.readUInt32LE(offset + 24),
      headerOffset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipFile(buffer, name, entry) {
  if (entry.encrypted) throw new UsageError(`${name} is encrypted`);
  if (entry.size > MAX_MANIFEST_BYTES) throw new UsageError(`${name} is larger than ${MAX_MANIFEST_BYTES} bytes`);
  const at = entry.headerOffset;
  if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== 0x04034b50) throw new UsageError("damaged zip entry");
  const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_MANIFEST_BYTES });
  throw new UsageError(`${name} uses compression method ${entry.method}`);
}

/** The package root is the top level, or the one folder holding everything (a macOS "Compress" zip has one). */
function findPackageRoot(entries) {
  const files = [...entries.keys()].filter((name) => !name.endsWith("/") && !name.startsWith("__MACOSX/"));
  if (files.includes("plugin.json")) return "";
  const tops = new Set(files.map((name) => name.split("/")[0]));
  if (tops.size === 1) {
    const root = `${[...tops][0]}/`;
    if (files.includes(`${root}plugin.json`)) return root;
  }
  throw new UsageError("no plugin.json");
}

// --- one zip -> one index entry ---------------------------------------------------------------

function checkManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new UsageError("plugin.json is not an object");
  if (typeof manifest.id !== "string" || !ID.test(manifest.id)) throw new UsageError(`id "${manifest.id}" must match ${ID}`);
  if (typeof manifest.version !== "string" || !SEMVER.test(manifest.version)) throw new UsageError(`version "${manifest.version}" is not a semver version`);
  for (const field of ["name", "description"]) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim()) throw new UsageError(`${field} must be a non-empty string`);
  }
  if (!RUNTIMES.includes(manifest.runtime)) throw new UsageError(`runtime must be one of ${RUNTIMES.join(", ")}`);
  if (manifest.minAppVersion !== undefined && !SEMVER.test(String(manifest.minAppVersion))) throw new UsageError(`minAppVersion "${manifest.minAppVersion}" is not a semver version`);
}

/** The text under the `## <version>` heading of a changelog (`## [1.0.0] - date` and `## v1.0.0` count too), without the heading. */
export function changelogSection(markdown, version) {
  const section = [];
  let inside = false;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^##\s/.test(line)) {
      if (inside) break;
      inside = line.replace(/^##\s+\[?v?/, "").startsWith(version);
    } else if (inside) section.push(line);
  }
  return section.join("\n").trim();
}

function entryFromZip(zipPath, baseUrl, released) {
  const file = path.basename(zipPath);
  const bytes = fs.readFileSync(zipPath);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  try {
    const sidecar = `${zipPath}.sha256`;
    if (fs.existsSync(sidecar)) {
      const listed = fs.readFileSync(sidecar, "utf8").trim().split(/\s+/)[0]?.toLowerCase();
      if (listed !== sha256) throw new UsageError(`checksum mismatch: ${file}.sha256 says ${listed}, the zip is ${sha256}`);
    }
    const entries = readZipEntries(bytes);
    const root = findPackageRoot(entries);
    const manifest = JSON.parse(readZipFile(bytes, "plugin.json", entries.get(`${root}plugin.json`)).toString("utf8"));
    checkManifest(manifest);
    if (file !== `${manifest.id}-${manifest.version}.zip`) throw new UsageError(`the file must be named ${manifest.id}-${manifest.version}.zip, as the url and the docs expect`);

    const entry = { id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description };
    if (manifest.category) entry.category = manifest.category;
    entry.runtime = manifest.runtime;
    if (manifest.permissions) entry.permissions = manifest.permissions;
    if (manifest.minAppVersion) entry.minAppVersion = manifest.minAppVersion;
    entry.url = `${baseUrl}/${encodeURIComponent(file)}`;
    entry.sha256 = sha256;
    entry.size = bytes.length;
    entry.released = released;
    const changelogName = typeof manifest.changelog === "string" ? path.posix.normalize(manifest.changelog) : "";
    if (entries.has(`${root}${changelogName}`)) {
      const section = changelogSection(readZipFile(bytes, changelogName, entries.get(`${root}${changelogName}`)).toString("utf8"), manifest.version);
      if (section) entry.changelog = section;
    }
    // A file in the package has no URL in an index: only an icon name or an absolute URL is carried over.
    if (typeof manifest.icon === "string" && /^(lucide:|https?:\/\/)/.test(manifest.icon)) entry.icon = manifest.icon;
    return entry;
  } catch (error) {
    // A truncated or damaged zip fails in many ways (RangeError, zlib errors, bad JSON): all of them are this file's problem.
    throw new UsageError(`${file}: ${error.message}`);
  }
}

// --- the index --------------------------------------------------------------------------------

export function buildIndex({ zipsDir, baseUrl, indexFile, name, released }) {
  if (!/^https?:\/\//.test(baseUrl)) throw new UsageError("--base-url must be an http(s) URL");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(released)) throw new UsageError("--date must look like 2026-11-01");
  if (!fs.existsSync(zipsDir) || !fs.statSync(zipsDir).isDirectory()) throw new UsageError(`--zips ${zipsDir} is not a folder`);
  const zips = fs.readdirSync(zipsDir).filter((file) => file.endsWith(".zip")).sort();
  if (zips.length === 0) throw new UsageError(`no .zip files in ${zipsDir}`);

  let index;
  if (fs.existsSync(indexFile)) {
    try {
      index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    } catch (error) {
      throw new UsageError(`${indexFile} is not valid JSON: ${error.message}`);
    }
    if (!Array.isArray(index.plugins)) throw new UsageError(`${indexFile} has no plugins list`);
  } else {
    index = { schema: 1, name, plugins: [] };
    if (!name) throw new UsageError(`${indexFile} does not exist yet: pass --name for the new index`);
  }

  const seen = new Map();
  const plugins = [...index.plugins];
  for (const file of zips) {
    const entry = entryFromZip(path.join(zipsDir, file), baseUrl.replace(/\/+$/, ""), released);
    if (seen.has(entry.id)) throw new UsageError(`${entry.id} is in more than one zip (${seen.get(entry.id)} and ${file})`);
    seen.set(entry.id, file);
    const at = plugins.findIndex((plugin) => plugin.id === entry.id);
    if (at === -1) {
      plugins.push(entry);
    } else if (typeof plugins[at].version !== "string" || !SEMVER.test(plugins[at].version)) {
      throw new UsageError(`${indexFile}: ${entry.id} is listed with the version "${plugins[at].version}", which is not a semver version`);
    } else if (plugins[at].version === entry.version && plugins[at].sha256 === entry.sha256) {
      // The same package again. Refresh the rest (a new base URL) but keep the release date.
      plugins[at] = { ...entry, released: plugins[at].released ?? entry.released };
    } else if (compareVersions(entry.version, plugins[at].version) > 0) {
      plugins[at] = entry;
    } else {
      throw new UsageError(`${entry.id} ${entry.version} is not newer than the listed ${plugins[at].version} (bump the version in plugin.json)`);
    }
  }
  plugins.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ...index, plugins };
}

function readOption(args, flag) {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith("--")) throw new UsageError(`missing value for ${flag}`);
  return value;
}

function main() {
  const args = process.argv.slice(2);
  try {
    const zipsDir = readOption(args, "--zips");
    const baseUrl = readOption(args, "--base-url");
    if (!zipsDir || !baseUrl) throw new UsageError("usage: plugin-index.mjs --zips <dir> --base-url <url> [--index index.json] [--name <name>] [--date YYYY-MM-DD]");
    const indexFile = path.resolve(readOption(args, "--index") ?? "index.json");
    const index = buildIndex({
      zipsDir: path.resolve(zipsDir),
      baseUrl,
      indexFile,
      name: readOption(args, "--name"),
      released: readOption(args, "--date") ?? new Date().toISOString().slice(0, 10),
    });
    fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
    console.log(`Wrote ${indexFile}: ${index.plugins.length} plugin${index.plugins.length === 1 ? "" : "s"}`);
  } catch (error) {
    if (error instanceof UsageError) fail(error.message);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
