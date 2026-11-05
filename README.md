# Shard Plugins

### Less tab-hopping. More getting things done.

**50+ focused tools. One desktop workspace. Your workflow, your plugins.**

The official plugin collection for [**Shard**](https://github.com/kinan9011/shard), the cross-platform developer toolbox. Format API data, inspect certificates, organize PDFs, convert images, generate keys, work with AI text and more—without constantly switching between websites.

**[Get Shard](https://github.com/kinan9011/shard/releases/latest)** · **[Browse the plugins](#explore-the-plugins)** · **[Build your own](#build-a-plugin)** · **[See releases](https://github.com/kinan9011/shard-plugins/releases/latest)**

> **Already using Shard?** Open **Plugins → Browse**. This official repository is configured by default, so you can discover and install the tools you need from inside the app.

## Why plugins?

- **Just the tools you need.** Keep Shard focused; add capabilities as your work demands them.
- **A familiar workspace.** Plugins follow the desktop app's theme, colors and supported interface languages.
- **Permissions you can review.** Plugins run in sandboxed frames and request host capabilities explicitly. Optional permissions can be declined.
- **Local-first workflows.** Many tasks run on your device. Downloading/installing plugins requires a connection; any plugin requesting network access needs an approved host permission.
- **Open to developers.** Each plugin is its own web app, with a manifest, tests and a reproducible ZIP packaging workflow.

## Start in three steps

1. **Install [Shard](https://github.com/kinan9011/shard/releases/latest)** on macOS, Windows or Linux.
2. Open **Plugins → Browse**. The official catalog is available by default.
3. Pick a plugin, review any requested permissions and install it. Open it from Shard when you're ready.

**No command line is needed to install plugins through the app.** The development commands further down are for contributors.

## Made for the small tasks that interrupt big work

| When you need to… | Reach for… |
| --- | --- |
| Turn a messy API response into something readable | [API Formatter](api-formatter/) or [Code Formatter](code-formatter/) |
| Work out why a token, certificate or checksum looks wrong | [Base64](base64/), [X.509 Certificate Decoder](certificate-decoder/), [Checksum](checksum/) |
| Clean up or restructure documents without uploading them to a website | [PDF Organizer](pdf-organizer/), [Image Converter](image-converter/) |
| Plan a cron job or inspect an IP range | [Cron Calculator](cron-calculator/), [IP / CIDR Calculator](ip-cidr/) |
| Draft diagrams, preview Markdown or work with UI colors | [Mermaid Renderer](mermaid-renderer/), [Markdown](markdown/), [Color Palette](color-palette/) |
| Prepare content for an AI workflow | [Secret & PII Redactor](secret-redactor/), [Token Counter](token-counter/), [AI Text Cleaner](ai-text-cleaner/) |

## Explore the plugins

The catalog below lists **51 plugins**, grouped by typical use case. Click a name to inspect its source folder. For the version and availability Shard actually sees, check the live [plugin catalog](index.json) or **Plugins → Browse** in the app.

**Permission key:** `CW` = `clipboard:write`; `FO` = `files:open`; `FS` = `files:save`. These are **optional** unless marked `!`. `—` means no explicitly declared host permissions. Web + WASM plugins run WebAssembly in the sandbox; WASM is a runtime, not an extra permission.

<details>
<summary><strong>Security, keys & privacy (9)</strong></summary>

| Plugin | What it does | Runtime | Permissions |
| --- | --- | --- | --- |
| [Hash Generator](hash-generator/) | Hash text and files with a Rust/WASM engine. | Web + WASM | `FO, CW` |
| [Bcrypt Generator](bcrypt-generator/) | Generate bcrypt password hashes locally. | Web | `CW` |
| [Checksum](checksum/) | Calculate CRC checksums and work with Luhn digits. | Web | `CW` |
| [Key Pair Generator](key-generator/) | Create RSA, ECDSA and Ed25519 keys. | Web | `CW, FS` |
| [Password Generator](password-generator/) | Generate passwords and passphrases. | Web | `CW` |
| [Random String](random-string/) | Generate configurable random strings. | Web | `CW` |
| [X.509 Certificate Decoder](certificate-decoder/) | Inspect certificates, CSRs and chains. | Web | `CW` |
| [ASN.1 Inspector](asn1-inspector/) | Explore DER/BER data as a structured tree. | Web | `CW` |
| [Secret & PII Redactor](secret-redactor/) | Mask sensitive text before sharing it with AI tools. | Web | `CW` |

</details>

<details>
<summary><strong>APIs, data & code (14)</strong></summary>

| Plugin | What it does | Runtime | Permissions |
| --- | --- | --- | --- |
| [API Formatter](api-formatter/) | Format JSON and convert URL-encoded API data. | Web | `CW` |
| [Base64](base64/) | Encode/decode Base64 and Base32 data. | Web | `CW, FS` |
| [CSV to JSON](csv-json/) | Convert tabular CSV data into JSON. | Web | `CW, FS` |
| [Config Converter](yaml-json/) | Convert configuration data formats. | Web | `CW` |
| [cURL to Code](curl-to-code/) | Turn cURL commands into code snippets. | Web | `CW` |
| [Code Formatter](code-formatter/) | Beautify or minify common code formats. | Web | `CW` |
| [HTML to JSX](html-to-jsx/) | Transform HTML markup into JSX. | Web | `CW` |
| [PHP Tools](php-tools/) | Convert PHP serialized data and arrays. | Web | `CW` |
| [XML Inspector](xml-inspector/) | Inspect and work with XML documents. | Web | `CW, FS` |
| [HAR Viewer](har-viewer/) | Inspect HTTP Archive request/response files. | Web | `CW, FS` |
| [Semver Calculator](semver/) | Compare versions and inspect version ranges. | Web | `CW` |
| [Number Base](number-base/) | Convert binary, octal, decimal and hex values. | Web | `CW` |
| [URL Encoder](url-encoder/) | Encode, decode and inspect URL components. | Web | `CW` |
| [Escape Tools](escape-tools/) | Escape or unescape text for different formats. | Web | `CW` |

</details>

<details>
<summary><strong>Text, writing & AI workflows (7)</strong></summary>

| Plugin | What it does | Runtime | Permissions |
| --- | --- | --- | --- |
| [Markdown](markdown/) | Edit Markdown with a sanitized HTML preview. | Web | `CW!` |
| [AI Text Cleaner](ai-text-cleaner/) | Clean up AI-generated text. | Web | `CW` |
| [Token Counter](token-counter/) | Count or estimate AI model tokens and costs. | Web | `CW` |
| [Case Converter](case-converter/) | Change casing and generate slugs. | Web | `CW` |
| [String Inspector](string-inspector/) | Inspect strings and their properties. | Web | `CW` |
| [Line Tools](line-tools/) | Process lines; run regex operations in a worker. | Web | `CW` |
| [Lorem Ipsum](lorem-generator/) | Generate placeholder text. | Web | `CW` |

</details>

<details>
<summary><strong>PDFs, images & visual tools (10)</strong></summary>

| Plugin | What it does | Runtime | Permissions |
| --- | --- | --- | --- |
| [PDF Organizer](pdf-organizer/) | Reorder, merge, split, rotate and export PDF pages. | Web | `FO, FS` |
| [Image Converter](image-converter/) | Convert, resize and compress images locally. | Web + WASM | `CW, FS` |
| [Image Metadata Cleaner](image-metadata/) | Remove image metadata and create clean copies. | Web + WASM | `CW, FS` |
| [Video Metadata Cleaner](video-metadata/) | Inspect and clean video metadata. | Web | `CW, FS` |
| [QR Generator](qr-generator/) | Generate QR codes and save PNG/SVG files. | Web | `CW, FS` |
| [QR Reader](qr-reader/) | Read QR code contents. | Web | `CW` |
| [Color Palette](color-palette/) | Explore colors, palettes and contrast. | Web | `CW` |
| [HTML Preview](html-preview/) | Preview HTML content. | Web | `—` |
| [SVG to CSS](svg-to-css/) | Turn SVG assets into CSS-ready output. | Web | `CW` |
| [Mermaid Renderer](mermaid-renderer/) | Render diagrams and export SVG/PNG. | Web | `CW, FS` |

</details>

<details>
<summary><strong>Time, dates & scheduling (6)</strong></summary>

| Plugin | What it does | Runtime | Permissions |
| --- | --- | --- | --- |
| [Cron Calculator](cron-calculator/) | Understand cron expressions and upcoming runs. | Web | `CW` |
| [Timestamp](timestamp/) | Work with Unix timestamps. | Web | `CW` |
| [Date Difference](date-difference/) | Calculate the difference between dates. | Web | `—` |
| [Date Format Translator](date-format/) | Translate date formatting tokens. | Web | `CW` |
| [Stopwatch](stopwatch/) | Measure elapsed time and export results. | Web | `CW, FS` |
| [Time Zone Converter](time-zone-converter/) | Convert time between zones. | Web | `CW` |

</details>

<details>
<summary><strong>Networking & everyday utilities (5)</strong></summary>

| Plugin | What it does | Runtime | Permissions |
| --- | --- | --- | --- |
| [IP / CIDR Calculator](ip-cidr/) | Calculate and inspect IP networks and ranges. | Web | `CW` |
| [chmod Calculator](chmod-calculator/) | Build Unix file permission settings. | Web | `CW` |
| [Unit Converter](unit-converter/) | Convert length, mass, temperature and data units. | Web | `—` |
| [Compression](compression/) | Compress or decompress GZIP/zlib/deflate data. | Web | `CW, FS` |
| [UUID Generator](uuid-generator/) | Generate UUIDs. | Web | `CW` |

</details>

**About permissions:** Most tools only request optional clipboard access to copy results. [Markdown](markdown/) requires `clipboard:write`, because copying output is a core part of its functionality. The PDF Organizer requests optional file-open and file-save access. To see the precise permission reasons, open each plugin's [`public/plugin.json`](pdf-organizer/public/plugin.json) (PDF Organizer shown as an example). See [Shard's permission documentation](https://github.com/kinan9011/shard/blob/main/docs/plugins/permissions.md) for how approvals and network host restrictions work.

## How the plugin system works

Each plugin is a self-contained **HTML, JavaScript and CSS** app, optionally using WebAssembly. Shard loads it in a sandboxed frame and exposes an SDK for approved operations such as opening a user-selected file, writing to the clipboard, showing a toast or storing small amounts of local state. A plugin does **not** get unrestricted desktop or filesystem access.

```text
shard-plugins/
├── index.json                 # Official catalog consumed by Shard
├── index.json.sig             # Catalog signature file
├── <plugin-id>/              # Self-contained Vite plugin project
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   ├── public/plugin.json   # Manifest and requested permissions
│   └── public/CHANGELOG.md
├── shared/                    # Code used when porting Shard tools
├── scripts/plugin-index.mjs   # Updates catalog records from ZIPs
├── Taskfile.yml               # Developer tasks
└── .github/workflows/release.yml
```

The app reads the [catalog](index.json). The release process packages plugin files into ZIPs, produces SHA-256 checksums and updates catalog entries. Shard checks package integrity when installing. See the [catalog format](https://github.com/kinan9011/shard/blob/main/docs/plugins/index-format.md), [manifest format](https://github.com/kinan9011/shard/blob/main/docs/plugins/manifest.md) and [SDK reference](https://github.com/kinan9011/shard/blob/main/packages/plugin-sdk/README.md).

### Privacy and permissions, without the marketing fog

A sandbox limits access to host APIs. Plugins declare permissions in their manifest and Shard enforces grants at the SDK boundary. The supported capabilities include clipboard read/write, user-selected file open/save, per-plugin storage and **network requests restricted to approved hosts**. Storage is available per plugin with a 1 MB quota. In general, tools can function without their optional permissions, but individual actions—such as copying or exporting—may require one.

**Local-first is not a blanket security guarantee.** Review a plugin's source and manifest before entering sensitive data, especially for third-party plugins. Offline processing should not be confused with installation or updates, which require downloading packages. [Read the permission specification](https://github.com/kinan9011/shard/blob/main/docs/plugins/permissions.md).

## Build a plugin

Want a developer tool Shard doesn't have yet? You can build one with standard web technologies and the [Shard Plugin SDK](https://github.com/kinan9011/shard/blob/main/packages/plugin-sdk/README.md).

**Requirements:** Node.js and npm; the specific Node.js minimum depends on the plugin (PDF Organizer requires Node.js 22.13+). [Go Task v3](https://taskfile.dev/docs/installation) is optional but recommended for running common repository commands.

1. Clone this repository. Obtain the [plugin template](https://github.com/kinan9011/shard/tree/main/packages/plugin-sdk/template) from the main Shard repository and copy it to a new `<plugin-id>/` folder here. IDs must be unique, 2–64 characters long, using lowercase letters, digits and dashes.
2. Edit `public/plugin.json`: `id`, `name`, `description`, `category`, `icon`, `runtime` (`web`, `wasm` or `web+wasm`) and `permissions`. Every requested permission needs a human-readable `reason`. Set the corresponding `name` and `version` in `package.json`.
3. Implement the tool in `src/App.tsx`. Use the SDK and app theme tokens for a consistent experience.
4. Install dependencies and test locally:

   ```bash
   cd <plugin-id>
   npm install
   npm run dev
   npm test
   npm run build
   ```

   The browser dev server can preview the interface, but SDK calls are not connected to Shard there; you'll see **Not connected** for host-dependent actions.
5. Test it in the desktop app: **Plugins → Install from folder**, then select `dist/` (or the packaged ZIP in `release/`). Sideloading requires enabling **Allow installs from outside these repositories** in Shard's settings.

The build produces:

- `dist/` — the deployable app (`plugin.json`, `index.html`, assets, etc.).
- `release/<id>-<version>.zip` — the packaged plugin.
- `release/<id>-<version>.zip.sha256` — its SHA-256 checksum.

The plugin must bundle the SDK file it needs (`src/shard-sdk.ts`); it cannot import files from outside its own package at runtime. Update that copy when the SDK changes.

### Repository commands

Run these from the repository root after installing dependencies for your chosen plugin. Replace `pdf-organizer` with another ID from `task plugins`.

```bash
task                       # List tasks
task plugins               # List plugin IDs and versions
task install -- pdf-organizer
task dev -- pdf-organizer
task test -- pdf-organizer
task typecheck -- pdf-organizer
task build -- pdf-organizer
task check -- pdf-organizer # Typecheck, test, build
task browser -- pdf-organizer
task test:tasks
```

`task build PLUGIN=pdf-organizer` is also supported. Browser tests only work for plugins that define `test:browser` (currently PDF Organizer); install Chromium first with `cd pdf-organizer && npx playwright install chromium`. The commands reuse each plugin's own npm scripts.

<details>
<summary><strong>Advanced: Port a built-in Shard tool</strong></summary>

Some tools were originally bundled with Shard and moved into plugins. Keeping their existing IDs allows pins, recent entries and older links to work again after installation. When Shard recognizes pasted content belonging to an uninstalled tool, it can suggest installing that plugin.

The repository's `shared/` directory helps port tools without copying the entire desktop app:

- `shared/components`, `shared/hooks`, `shared/lib` — adapted UI and utility code, including SDK-backed copy/save helpers.
- `shared/shims/sonner.ts` — route toasts through `sdk.toast`.
- `shared/storage-shim.ts` — local-storage compatibility backed by `sdk.storage` (1 MB per-plugin limit).
- `shared/bootstrap.tsx` — `mountTool(Tool, { form })`, host theme, layout and visibility handling.
- `shared/lib/i18n.ts` and `i18n-common.ts` — plugin localization and common text.
- `shared/tool.css` — shared tool presentation without the desktop shell.
- `shared/template/` — ported-tool configuration.

From the repository root:

```bash
node scripts/port-tool.mjs <tool-id> --app <path-to-shard-repo>
```

Without `--app`, the script uses the repository's existing default path (`../../GitHub/devtools`). It traces app imports, copies dependent code and tests and generates the plugin structure. Each plugin must remain self-contained because releases build it in isolation. `--force` refreshes a port **and overwrites its folder**: back up manual changes before using it.

After porting, write a useful `description` in `public/plugin.json`, then run `npm install`, `npm test` and `npm run build` in that plugin folder.

**Hash Generator exception:** Its Rust/WASM sources live in `hash-generator/wasm/`. To rebuild, install the `wasm32-unknown-unknown` Rust target, run `npm run test:wasm` and `npm run build:wasm` from `hash-generator/`, and commit the rebuilt `public/hash.wasm`. The release workflow does not compile Rust.

</details>

<details>
<summary><strong>Advanced: Localization and right-to-left layout</strong></summary>

Plugins follow Shard's app language: **English, German, Arabic, French, Spanish, Chinese, Japanese and Hebrew**. The host passes `{ lang, dir }` during the SDK handshake and on language changes; `mountTool` / `followHostLocale` updates the frame's `<html lang>` and `<html dir>`. Other languages fall back to English.

- Put interface strings in `src/locales/{en,de,ar,fr,es,zh,ja,he}.ts`, using flat keys such as `"area.thing"`.
- Treat `en.ts` as the type-checked source of truth. `tests/locales.test.ts` checks missing/extra keys, placeholders and plural forms.
- Use `useT()` in components or `t()` in utilities when the string is needed, not at module scope.
- Plural forms: Arabic needs `_zero`, `_one`, `_two`, `_few`, `_many`, `_other`; Hebrew needs `_one`, `_two`, `_other`; Japanese and Chinese use `_other`.
- Use logical Tailwind classes (`ms-`, `pe-`, `start-`, `text-start`, etc.) for RTL interfaces; keep code and generated hashes `dir="ltr"`.
- Test language presentation locally by loading the dev server with `?lang=ar`, `?lang=he` or another locale.

Manifest names, descriptions and permission reasons in `public/plugin.json` are not translated by the app yet.

</details>

## Contributing and support

Found a bug, have a useful plugin idea, or want to improve an existing one? [Open an issue](https://github.com/kinan9011/shard-plugins/issues) or [propose a pull request](https://github.com/kinan9011/shard-plugins/pulls).

For a smooth review, include what the plugin does, screenshots for UI changes, requested permissions and why they're needed, test coverage and changelog/version updates when applicable. Keep runtime dependencies inside the plugin's package and do not introduce network permissions unless the feature requires them.

- **Shard desktop app:** [github.com/kinan9011/shard](https://github.com/kinan9011/shard)
- **Plugin SDK:** [SDK documentation](https://github.com/kinan9011/shard/blob/main/packages/plugin-sdk/README.md)
- **Issues and requests:** [shard-plugins issues](https://github.com/kinan9011/shard-plugins/issues)
- **Releases:** [shard-plugins releases](https://github.com/kinan9011/shard-plugins/releases)

---

**The tools you need. The workflow you want. All inside Shard.**
