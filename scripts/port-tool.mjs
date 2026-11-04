#!/usr/bin/env node
// Turns a tool that is built into the Shard app into a plugin folder here.
//
//   node scripts/port-tool.mjs <tool-id> [--app <path to the shard repo>] [--force] [--dry]
//
// Reads the tool's entry from src/app/toolRegistry.ts, copies the component and everything it imports into
// <tool-id>/src (same paths as in the app, so no import changes), swaps the app-only pieces for the ones in
// shared/ (SDK-backed CopyButton, `sonner` and src/lib/desktop), copies the tests that cover it, and writes
// package.json, plugin.json, vite/vitest/tailwind config and main.tsx.
//
// It prints the app files it copied, so the app side can delete the ones nothing else uses. After a run:
// fill in `description` in public/plugin.json, run `npm install && npm test && npm run build` in the folder.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shared = path.join(root, "shared");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const id = argv.find((arg, i) => !arg.startsWith("--") && argv[i - 1] !== "--app");
const app = path.resolve(option("--app") ?? process.env.SHARD_APP ?? path.join(root, "../../GitHub/devtools"));
if (!id) {
  console.error("Usage: node scripts/port-tool.mjs <tool-id> [--app <shard repo>] [--force]");
  process.exit(1);
}
const out = path.join(root, id);
if (fs.existsSync(out) && !flag("--force") && !flag("--dry")) {
  console.error(`${id}/ already exists. Use --force to write over it.`);
  process.exit(1);
}

const read = (file) => fs.readFileSync(file, "utf8");
const warn = (message) => console.warn(`warning: ${message}`);

// ---- the tool's entry in the app ----
const registry = read(path.join(app, "src/app/toolRegistry.ts"));
const entry = registry.match(new RegExp(`\\{ icon: (\\w+), name: "([^"]+)", id: "${id}", category: "([^"]+)", keywords: \\[([^\\]]*)\\]`));
if (!entry) {
  console.error(`No tool "${id}" in ${app}/src/app/toolRegistry.ts`);
  process.exit(1);
}
const [, iconName, name, category, keywordList] = entry;
const keywords = [...keywordList.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
// `Image as ImageIcon` is imported under another name: the plugin icon is the lucide name.
const icon = registry.match(new RegExp(`(\\w+) as ${iconName}\\b`))?.[1] ?? iconName;
const component = registry.match(new RegExp(`"?${id}"?: lazyNamed\\(\\s*\\(\\) => import\\("@/components/tools/(\\w+)"\\),\\s*"(\\w+)"`));
if (!component) {
  console.error(`No component for "${id}" in TOOL_COMPONENTS.`);
  process.exit(1);
}
const [, componentFile, componentName] = component;
const workspace = new RegExp(`WORKSPACE_TOOL_IDS = new Set<string>\\(\\[[^\\]]*"${id}"`).test(read(path.join(app, "src/components/app/ToolHost.tsx")));

// ---- the import walk ----
const EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|vi\.mock\(\s*)["']([^"']+)["']/g;
const fixSonner = (code) => code.replace(/(from\s*|vi\.mock\(\s*)(["'])sonner\2/g, '$1"@/shims/sonner"');

/** A file of the src/ tree: shared/ wins over the app, which is how the app-only pieces get swapped. */
function locate(rel) {
  for (const [origin, base] of [["shared", shared], ["app", path.join(app, "src")]]) {
    for (const ext of EXTS) {
      const abs = path.join(base, rel + ext);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return { rel: rel + ext, abs, origin };
    }
  }
  return null;
}

const files = new Map(); // src-relative path -> { code, origin }
const packages = new Set();
const missing = [];

function specifierTarget(spec, fromRel) {
  const bare = spec.split("?")[0];
  if (bare.startsWith("@/")) return bare.slice(2);
  if (bare.startsWith(".")) return path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), bare));
  return null;
}

function addPackage(spec) {
  const parts = spec.split("/");
  packages.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
}

const seen = new Set();
for (const l of ["en", "de", "ar", "fr", "es", "zh", "ja", "he"]) seen.add(`locales/${l}`); // the tool's own strings, written from the template below
function walk(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const found = locate(rel);
  if (!found) return void missing.push(rel);
  if (files.has(found.rel)) return;
  if (!/\.(ts|tsx)$/.test(found.rel)) return void files.set(found.rel, { origin: found.origin, abs: found.abs }); // css, json, wasm...
  const code = fixSonner(read(found.abs));
  files.set(found.rel, { origin: found.origin, code });
  for (const [, spec] of code.matchAll(IMPORT)) {
    const target = specifierTarget(spec, found.rel);
    if (target) walk(target);
    else if (spec.startsWith("node:")) warn(`${found.rel} imports ${spec}; check it works in the browser`);
    else addPackage(spec);
  }
}

walk(`components/tools/${componentFile}`);
walk("bootstrap"); // renders the tool, applies the theme
if (missing.length) warn(`not found: ${missing.join(", ")}`);

const appFiles = [...files].filter(([, f]) => f.origin === "app").map(([rel]) => `src/${rel}`);

// ---- tests ----
const testsRoot = path.join(app, "tests");
const tests = new Map(); // tests-relative path -> code
const skippedTests = [];
const testPackages = new Set();
const ownedByApp = new Set(appFiles.map((f) => f.slice(4)));

function collectTests(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTests(abs);
    else if (/\.test\.tsx?$/.test(entry.name)) considerTest(abs);
  }
}

function rewriteTest(abs, code, helpers) {
  const pkgs = new Set();
  const fromRel = path.relative(testsRoot, abs).split(path.sep).join("/");
  let usesOwn = false;
  let usesOther = false;
  const rewritten = fixSonner(code).replace(IMPORT, (whole, spec) => {
    const bare = spec.split("?")[0];
    let srcRel = null;
    if (bare.startsWith("@/")) srcRel = bare.slice(2);
    else if (bare.startsWith(".")) {
      const target = path.resolve(path.dirname(abs), bare);
      if (target.startsWith(path.join(app, "src") + path.sep)) srcRel = path.relative(path.join(app, "src"), target).split(path.sep).join("/");
      else if (target.startsWith(testsRoot + path.sep)) {
        const helper = EXTS.map((ext) => target + ext).find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (helper) helpers.push(helper);
      }
    } else if (!bare.startsWith("node:")) {
      pkgs.add(bare.startsWith("@") ? bare.split("/").slice(0, 2).join("/") : bare.split("/")[0]);
    }
    if (srcRel) {
      const located = locate(srcRel);
      const resolved = located?.rel ?? srcRel;
      if (ownedByApp.has(resolved)) usesOwn = true;
      else if (!located || located.origin === "app") usesOther = true; // an app file the plugin does not have
      return whole.replace(spec, `@/${srcRel}`);
    }
    return whole;
  });
  return { rewritten, usesOwn, usesOther, fromRel, pkgs };
}

function considerTest(abs) {
  const helpers = [];
  const { rewritten, usesOwn, usesOther, fromRel, pkgs } = rewriteTest(abs, read(abs), helpers);
  if (!usesOwn) return;
  if (usesOther) return void skippedTests.push(fromRel);
  tests.set(fromRel, rewritten);
  for (const pkg of pkgs) testPackages.add(pkg);
  for (const helper of helpers) { // fixtures the test imports from tests/ come along
    const helperRel = path.relative(testsRoot, helper).split(path.sep).join("/");
    if (!tests.has(helperRel)) {
      const result = rewriteTest(helper, read(helper), []);
      tests.set(helperRel, result.rewritten);
      for (const pkg of result.pkgs) testPackages.add(pkg);
    }
  }
}
collectTests(testsRoot);

// ---- write the folder ----
if (flag("--dry")) {
  console.log(`APP_FILES ${appFiles.join(" ")}`);
  console.log(`APP_TESTS ${[...tests.keys()].filter((t) => /\.test\.tsx?$/.test(t)).map((t) => `tests/${t}`).join(" ")}`);
  process.exit(0);
}
fs.rmSync(out, { recursive: true, force: true });
const write = (rel, content) => {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const copyTemplate = (rel, transform = (text) => text) => write(rel, transform(read(path.join(shared, "template", rel))));

for (const [rel, file] of files) {
  if (file.abs) fs.mkdirSync(path.dirname(path.join(out, "src", rel)), { recursive: true }) ?? fs.copyFileSync(file.abs, path.join(out, "src", rel));
  else write(`src/${rel}`, file.code);
}
for (const [rel, code] of tests) write(`tests/${rel}`, code);
write("src/tool.css", read(path.join(shared, "tool.css")));
for (const rel of ["postcss.config.js", "tailwind.preset.ts", "tailwind.config.ts", "tsconfig.json", "vite.config.ts", "vitest.config.ts", "scripts/pack.mjs", "tests/setup.ts", "tests/i18n.test.ts", "tests/locales.test.ts", "public/CHANGELOG.md", "src/index.css", ".gitignore", ...["en", "de", "ar", "fr", "es", "zh", "ja", "he"].map((l) => `src/locales/${l}.ts`)]) copyTemplate(rel);
// The shared components translate through these; the tool's own strings go into src/locales/*.ts.
for (const rel of ["i18n.ts", "i18n-common.ts"]) write(`src/lib/${rel}`, read(path.join(shared, "lib", rel)));
copyTemplate("index.html", (html) => html.replace("__NAME__", name));
write("src/main.tsx", `import { mountTool } from "./bootstrap";\nimport { ${componentName} } from "@/components/tools/${componentFile}";\nimport "./index.css";\n\nvoid mountTool(${componentName}, { form: ${!workspace} });\n`);

// ---- package.json and plugin.json ----
const appPackage = JSON.parse(read(path.join(app, "package.json")));
const versionOf = (pkg) => appPackage.dependencies?.[pkg] ?? appPackage.devDependencies?.[pkg];
const template = JSON.parse(read(path.join(root, "uuid-generator/package.json"))); // the pilot has the dev toolchain
const dependencies = {};
for (const pkg of [...packages, "react", "react-dom", "tailwindcss-animate"].sort()) {
  const version = versionOf(pkg) ?? template.dependencies?.[pkg];
  if (version) dependencies[pkg] = version;
  else warn(`no version for ${pkg}; add it to package.json`);
}
const devDependencies = { ...template.devDependencies };
for (const pkg of testPackages) if (!dependencies[pkg] && !devDependencies[pkg] && versionOf(pkg)) devDependencies[pkg] = versionOf(pkg);
for (const pkg of Object.keys(dependencies)) delete devDependencies[pkg];
const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : 1)));
write("package.json", JSON.stringify({ ...template, name: id, description: `${name} plugin. Keep \`version\` in step with public/plugin.json.`, version: "1.0.0", dependencies: sorted(dependencies), devDependencies: sorted(devDependencies) }, null, 2) + "\n");

// The SDK plumbing mentions every permission; only the tool's own code (and CopyButton) says what it needs.
const plumbing = /^(lib\/desktop|bootstrap|sdk|shard-sdk|shims\/)/;
const source = [...files].filter(([rel]) => !plumbing.test(rel)).map(([, f]) => f.code ?? "").join("\n");
const permissions = [];
if (/writeClipboardText|CopyButton/.test(source)) permissions.push({ name: "clipboard:write", reason: "Copy results", optional: true });
if (/readClipboardText/.test(source)) permissions.push({ name: "clipboard:read", reason: "Paste from the clipboard", optional: true });
if (/\bsaveFile\b/.test(source)) permissions.push({ name: "files:save", reason: "Save results to a file", optional: true });
write("public/plugin.json", JSON.stringify({
  id, name, version: "1.0.0",
  description: `${name}. Runs sandboxed; nothing is uploaded.`, // ponytail: edit by hand
  category, keywords, icon: `lucide:${icon}`, entry: "index.html", runtime: "web", permissions,
  minAppVersion: "3.0.0", license: "MIT", source: "https://github.com/kinan9011/shard-plugins", changelog: "CHANGELOG.md",
}, null, 2) + "\n");

console.log(`Ported ${name} (${id}) to ${id}/: ${files.size} source files (${appFiles.length} from the app), ${tests.size} test files.`);
console.log(`Layout: ${workspace ? "workspace (fills the panel)" : "form (single column)"}`);
console.log(`Permissions: ${permissions.map((p) => p.name).join(", ") || "none"}`);
if (skippedTests.length) warn(`tests not copied (they use app files the plugin does not have): ${skippedTests.join(", ")}`);
console.log(`APP_FILES ${appFiles.join(" ")}`);
console.log(`APP_TESTS ${[...tests.keys()].filter((t) => /\.test\.tsx?$/.test(t)).map((t) => `tests/${t}`).join(" ")}`);
