# Shard plugins

The official plugin repository for [Shard](https://github.com/kinan9011/shard). Shard adds
`github.com/kinan9011/shard-plugins` as its first repository, so everything released here shows
up in the app under **Plugins → Browse**.

## How it fits together

```
index.json                       the catalog Shard reads (updated by the release workflow)
<plugin-id>/                     one folder per plugin: a Vite project made from the template
  package.json, vite.config.ts, src/, scripts/pack.mjs
  public/plugin.json             the manifest (copied into dist/ by the build)
  public/CHANGELOG.md
scripts/plugin-index.mjs         turns built zips into index.json entries
.github/workflows/release.yml    on a v* tag: build changed plugins, publish zips, update index.json
```

A plugin is a web app (HTML, JS, CSS, optionally WASM) that runs in a sandboxed frame and talks to
Shard through the [plugin SDK](https://github.com/kinan9011/shard/blob/main/packages/plugin-sdk/README.md).
It can only do what the user approves: see the
[permissions](https://github.com/kinan9011/shard/blob/main/docs/plugins/permissions.md) and the
[manifest](https://github.com/kinan9011/shard/blob/main/docs/plugins/manifest.md) docs.

## Plugins

| Folder | Tool | Runtime | Asks for |
| --- | --- | --- | --- |
| `hash-generator/` | Hash Generator | web+wasm (Rust, no dependencies) | `files:open`, `clipboard:write` (both optional) |
| `uuid-generator/` | UUID Generator | web | `clipboard:write` (optional) |
| `cron-calculator/` | Cron Calculator | web | `clipboard:write` (optional) |
| `markdown/` | Markdown | web | `clipboard:write` (required) |
| `color-palette/` | Color Palette | web | `clipboard:write` (optional) |
| `unit-converter/` | Unit Converter | web | none |
| `chmod-calculator/` | chmod Calculator | web | `clipboard:write` (optional) |
| `checksum/` | Checksum | web | `clipboard:write` (optional) |
| `ip-cidr/` | IP / CIDR Calculator | web | `clipboard:write` (optional) |
| `har-viewer/` | HAR Viewer | web | `clipboard:write`, `files:save` (both optional) |
| `timestamp/` | Timestamp | web | `clipboard:write` (optional) |
| `date-difference/` | Date Difference | web | none |
| `date-format/` | Date Format Translator | web | `clipboard:write` (optional) |
| `stopwatch/` | Stopwatch | web | `clipboard:write`, `files:save` (both optional) |
| `time-zone-converter/` | Time Zone Converter | web | `clipboard:write` (optional) |
| `api-formatter/` | API Formatter | web | `clipboard:write` (optional) |
| `string-inspector/` | String Inspector | web | `clipboard:write` (optional) |
| `line-tools/` | Line Tools | web (regex runs in a worker) | `clipboard:write` (optional) |
| `password-generator/` | Password Generator | web | `clipboard:write` (optional) |
| `lorem-generator/` | Lorem Ipsum | web | `clipboard:write` (optional) |
| `qr-generator/` | QR Generator | web | `clipboard:write`, `files:save` (both optional) |
| `bcrypt-generator/` | Bcrypt Generator | web | `clipboard:write` (optional) |
| `random-string/` | Random String | web | `clipboard:write` (optional) |
| `key-generator/` | Key Pair Generator | web | `clipboard:write`, `files:save` (both optional) |
| `base64/` | Base64 | web | `clipboard:write`, `files:save` (both optional) |
| `case-converter/` | Case Converter | web | `clipboard:write` (optional) |
| `number-base/` | Number Base | web | `clipboard:write` (optional) |
| `url-encoder/` | URL Encoder | web | `clipboard:write` (optional) |
| `csv-json/` | CSV to JSON | web | `clipboard:write`, `files:save` (both optional) |
| `yaml-json/` | Config Converter | web | `clipboard:write` (optional) |

These used to be built into Shard. Their ids are the old tool ids, so a pin, a recent
entry or a link from an older version works again once the plugin is installed. A paste in Shard that fits one
of them (a UUID, a cron expression, a color) suggests "Install <tool>" while it is not installed.

Copying needs `clipboard:write`. Cron Calculator and Color Palette only copy on request, so they run without it and
a refused copy shows a notice in the app. Markdown's job is copying the Markdown and the HTML, so it asks for it.
Color Palette keeps its recent colors with `sdk.storage` (the frame has no `localStorage`).

In each folder, `npm test` runs the plugin's tests (the shard repo's `npm test` runs them too).
Hash Generator's hashing is a Rust crate in `hash-generator/wasm/`: `npm run test:wasm` runs its tests, and
`npm run build:wasm` rebuilds `public/hash.wasm` from it (needs `rustup target add wasm32-unknown-unknown`).
Commit the rebuilt `hash.wasm`: the release workflow does not run Rust.

## Porting a tool from the app

Most tools that were built into Shard are being moved here. `shared/` is what they need from the app, on top of the SDK:

- `shared/components`, `hooks`, `lib`: files copied from the app (`ui/*`, `ToolWorkspace`, `ToolFaq`, `useDebouncedValue`, ...), plus an SDK-backed `CopyButton` and `lib/desktop.ts` (`saveFile`, clipboard through the host).
- `shared/shims/sonner.ts`: `toast` shows the app's toast through `sdk.toast`.
- `shared/storage-shim.ts`: the frame has no `localStorage`, so `mountTool` installs one that is saved in `sdk.storage` (one key, 1 MB).
- `shared/bootstrap.tsx`: `mountTool(Tool, { form })` applies the app theme, pauses on `onVisibilityChange` (`useToolActive`) and wraps single-column tools like the app does.
- `shared/tool.css`: the tool rules of the app's `index.css` (generated, without the app shell).
- `shared/template/`: the config files every plugin gets.

`node scripts/port-tool.mjs <tool-id>` (`--app <shard repo>`, default `../../GitHub/devtools`) follows the tool's imports in the app and
writes `<tool-id>/`: the files it needs at the same paths under `src/` (so the code needs no import changes), the `shared/` files it uses,
the tests that cover it, `package.json` (dependencies with the app's versions), `public/plugin.json` and the config. Every plugin folder is
self-contained, because the release workflow builds each one alone: `shared/` is copied in, not imported. Re-run the script with `--force`
to refresh a port; it overwrites the folder. Afterwards write the `description` in `public/plugin.json` and run
`npm install && npm test && npm run build`. Ported plugins keep the tool's old id.

## Add a plugin

1. Copy the template from the shard repo, `packages/plugin-sdk/template/`, to `<plugin-id>/`.
   The id is lowercase letters, digits and dashes (2 to 64 characters) and must be unique.
2. Edit `public/plugin.json`: `id`, `name`, `description`, `category`, `icon` (`lucide:<Name>` or a
   file in `public/`), `runtime` (`web`, `wasm` or `web+wasm`) and `permissions`. Every permission
   needs a `reason` the user will read. Set `name` and `version` in `package.json` as well.
3. Build the tool in `src/App.tsx`. The template already connects to the host, applies the app's
   theme (light, dark and color schemes) and styles with the app's Tailwind tokens, so
   `bg-background`, `text-muted-foreground` and `rounded-lg` look like the rest of the app.
4. `npm install`, then `npm run dev` for a quick look in a browser. Outside Shard there is no
   host, so SDK calls fail and the page says "Not connected".
5. To try it in the app: `npm run build`, then in Shard use **Plugins → Install from folder** and
   pick `dist/` (or the zip from `release/`). Sideloads need the setting "Allow installs from outside
   these repositories".

`npm run build` writes:

- `dist/`: the package contents (`plugin.json`, `index.html`, `assets/`, ...)
- `release/<id>-<version>.zip`: `dist/` as a zip, the same bytes for the same files on any machine
- `release/<id>-<version>.zip.sha256`: its SHA-256, the checksum Shard verifies

Keep `src/shard-sdk.ts` as it is: it is a copy of the SDK, because a plugin can load only files
from its own package. When the SDK changes, copy the new file over from the shard repo.

## Release

1. Raise `version` in `public/plugin.json` and `package.json` (semver) and add a `## <version>`
   section to `public/CHANGELOG.md`. The first section becomes the update's changelog in the app.
2. Merge to the default branch.
3. Push a tag: `git tag v7 && git push origin v7`.

The workflow builds the plugins whose files changed since the previous `v*` tag (all of them for the
first tag), uploads their zips as assets of the tag's release and commits the new entries to
`index.json`. A plugin whose version was not raised fails the run before anything is published.
Versions are per plugin; the `v*` tag is only a release batch.

To check the index step on your machine:

```sh
(cd <plugin-id> && npm run build)
mkdir -p /tmp/zips && cp <plugin-id>/release/* /tmp/zips/
node scripts/plugin-index.mjs --zips /tmp/zips --base-url https://example.com/dl --index /tmp/index.json --name Test
```

## index.json

The format is described in
[`docs/plugins/index-format.md`](https://github.com/kinan9011/shard/blob/main/docs/plugins/index-format.md).
`scripts/plugin-index.mjs` fills `plugins` from the zips. It keeps everything else, so edit these by hand:

- `name`: the repository's name in the app.
- `bundles` (optional): named sets of plugin ids that the first-run screen of the Launcher layout offers,
  for example `{ "id": "developer", "name": "Developer", "plugins": ["hash-generator", "uuid-generator"] }`.
  Every id has to be listed in `plugins`.

`scripts/plugin-index.mjs` is a copy of the script in the shard repo (`scripts/plugin-index.mjs`).
It has no dependencies.

## Releasing

1. In the repository settings, allow Actions to write to contents (the workflow asks for
   `contents: write`) and make the repository public, so the app can read `index.json`.
2. Push a tag to publish: `git tag v1 && git push origin v1`.
