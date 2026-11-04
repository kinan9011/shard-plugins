# PDF Forms

Read, fill and batch-export AcroForm PDFs locally in Shard. Built for Kanzo task `shard-plugins#33`.

## Use

1. Open a PDF or drop one into the plugin.
2. Complete text, checkbox, dropdown, list and radio fields in the field panel. Required fields have an asterisk; read-only and unsupported fields are identified.
3. Review the generated PDF appearance beside the fields. Focusing a field opens its page; clicking its position in the preview focuses the field.
4. Choose **Save PDF** or press **Ctrl/Cmd+S**. The result remains editable by default.

**Flatten saved copy** deliberately removes editable fields from the output after confirmation. The original file and the editing session stay intact. Saving signed PDFs can invalidate signatures; the plugin does not verify signatures. Signature and specialized fields prevent flattening.

## JSON / CSV and batch filling

Open **Import / batch** and save a JSON template to obtain the exact writable field names. Import a file or paste a mapping, choose its format, and apply it. A single object/row fills the current form. Multiple rows enable a row preview and **Save forms as ZIP**. Each row starts from the current field values; it does not inherit the previous row.

```json
[
  { "person.name": "Alice", "consent": true },
  { "person.name": "Bob", "consent": true }
]
```

```csv
person.name,consent
"Lovelace, Ada",true
Bob,1
```

These field names are illustrative; use your PDF's names. JSON accepts strings, booleans and arrays of strings for multi-select fields. CSV accepts `true`/`false` and `1`/`0` for checkboxes; multi-select cells contain a JSON array with CSV quoting, such as `"[""Art"",""Music""]"`. Missing keys preserve current values. Unknown fields, invalid options and changes to read-only fields are rejected. Every batch row must satisfy required fields before export.

## Limits

- 50 MiB per input PDF, 500 pages, 1,000 fields.
- Mapping: 2 MiB, up to 100 rows. Batch PDFs together and the final ZIP must each fit within 50 MiB.
- Password-protected, XFA and malformed PDFs are rejected. Signatures and specialized fields are displayed but cannot be edited.
- Updated text appearances use Helvetica's Latin character set. Unsupported characters cause an explicit error; they are never silently discarded. Existing untouched field appearances retain their original fonts. Complex formatting and malformed form appearances may require a dedicated PDF editor.
- Processing uses cancellable local workers. There are no network permissions or uploads, and form values are not persisted between sessions.

## Develop and package

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:browser
```

From the repository root, `task check -- pdf-forms` and `task browser -- pdf-forms` use the same scripts. Browser checks require Playwright Chromium and Poppler's `pdftotext` / `pdftoppm`. Build outputs are `dist/` and `release/pdf-forms-1.0.0.zip` with a SHA-256 sidecar. Worker scripts, PDF.js resources and dependency licenses are bundled locally. Shared SDK/bootstrap/i18n sources are copied into this folder during preparation and retained for isolated builds.

The UI inherits Shard's host theme variables, typography, compact controls, split editor layout, status bar and locale/visibility events. English, German and Arabic dictionaries are provided; the shared locale system falls back to English for other app languages. Arabic uses RTL layout and Western digits.

## Acceptance

Unit and browser checks cover canonical values and appearance streams, all supported field types, mapping validation, batch ZIP contents, intentional flattening with complete widget cleanup, cancellation/denied-save recovery, keyboard saves, opaque-origin workers, responsive themes and RTL. Browser output is reopened with pdf-lib and independently rendered/read with Poppler; PDF.js renders generated appearances in the editor.

Native Shard installation, custom-scheme/CSP behavior, actual OS file dialogs, host shortcut routing, manual screen-reader use, large-file performance and complex third-party forms need host acceptance. Review the saved PDF in your usual viewer before sharing it.
