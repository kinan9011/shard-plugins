# PDF Compressor

A local PDF compressor for Shard. No upload, network permission, telemetry or external assets. Follows the host theme and all eight app languages: English, German, Arabic, French, Spanish, Chinese, Japanese and Hebrew, including RTL and Western digits.

Drop a PDF anywhere in the plugin or use **Open PDF**. The drop area highlights while a file is dragged over it. In Shard, **Browse files** also offers the browser picker; outside Shard, **Open PDF** uses that picker directly. After opening, choose a compression level, review the processing notice, then **Compress PDF**. **More options** holds all method, resolution, color, quality, flattening and cleanup controls; choosing **Custom** opens it automatically. The result appears after compression with actual original/output sizes, percentage change, and a first-page preview. **Save PDF** opens the host's save dialog with a new suggested filename. Saving is reported only after host confirmation; permission denial and cancellation retain the result for retry. Keep the original and check every output page before sharing.

## Compression options

| Option | Behaviour |
| --- | --- |
| Gentle | Keeps text and vector content, interactive fields, page geometry and document structure where supported. Compresses unfiltered streams, uses compressed object streams and drops unreachable objects. Does not resample existing images. |
| Balanced | Rebuilds every visible page as an image at 150 DPI, JPEG quality 78%. |
| Strong | Page images at 100 DPI, JPEG quality 60%. |
| Extreme | Page images at 72 DPI, JPEG quality 40%. |
| Custom | Change the method, DPI (36–300), JPEG quality (10–100%), color mode and black/white threshold. |
| Grayscale | Page-image mode; removes visible color before JPEG encoding. |
| Black and white | Page-image mode; thresholded, true 1-bit DeviceGray images compressed losslessly with Flate. Useful for text scans. JPEG quality does not apply. Increasing the threshold darkens faint text; photos and shading can disappear. |
| Flatten form fields | In optimization mode, paints existing field appearances into page content and removes field widgets. Keeps selectable page text and other annotations. Missing appearances may prevent export. |
| Flatten everything visible | Switches to page-image mode. Paints visible annotations and form appearances into the page, then discards links, editable fields, attachments, bookmarks, accessibility tags, layers and hidden content. |
| Remove document metadata | Enabled by default. Removes the Info dictionary and XMP metadata streams, including object-level Metadata entries. Does not redact page content, annotation authors or arbitrary private data. |
| Remove attachments and bookmarks | Optional in optimization mode; removes EmbeddedFiles, associated-file entries, file-attachment annotations and outlines. Always implicit in page-image mode. |

Presets affect the method, resolution and quality; cleanup preferences remain under user control. Selecting Gentle restores color output. Changing options clears the previous result so it cannot be mistaken for a result from the current settings. A larger output is shown honestly and can still be saved when conversion or flattening was requested; the plugin never silently substitutes the original.

## Limits and tradeoffs

- One PDF at a time, 50 MiB input/output, 500 pages. Raster image data is bounded to 50 MiB total. Each page is limited to 12 million pixels and 16384 pixels per side; lower DPI if exceeded. Rendering does not silently lower the requested resolution. Pages render sequentially and canvases are released after encoding.
- PDF parsing and writing use disposable workers with a 60-second timeout. Compression has a three-minute overall timeout. Cancel terminates processing and preserves the original. Preview has a separate 30-second timeout.
- Password-protected/encrypted and XFA PDFs are rejected. Permissions are not bypassed.
- Every export rewrites the PDF and invalidates cryptographic signatures. Detected signature dictionaries/fields produce an additional notice. Detection is not signature validation.
- Page-image output loses searchable/selectable text, vector sharpness, accessibility structure and interactivity. Only visible, supported content is rendered; this does not preserve all optional layers or hidden annotations. It uses the displayed crop box and rotation, preserves displayed physical dimensions, and paints transparency against white.
- PDF.js rendering disables eval, WASM and dynamic image decoders. Unusual image/font encodings may not render correctly. Always review the output against the original; the first-page preview cannot verify the whole document.
- Scans usually shrink more than text-only or already optimized PDFs. Stronger settings can make some files larger. No target-size guarantee, OCR, font subsetting, native image resampling that preserves text, PDF/A conversion or signature preservation is included.
- Metadata/attachment removal is a size-reduction feature, not document sanitization or redaction.

## Build and install

Requires Node 22.13+ (Node 24 recommended).

```sh
cd pdf-compressor
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Build output: `dist/`, `release/pdf-compressor-1.0.0.zip`, and its SHA-256 file. Install the folder or ZIP through Shard's plugin installer. From the repository root, `task install|check|browser -- pdf-compressor` runs the corresponding scripts. The release workflow discovers the manifest automatically; `index.json` remains release-managed.

The folder is self-contained. SDK, bootstrap and localization utilities follow PDF Organizer's existing patterns. `scripts/prepare.mjs` builds classic blob-compatible PDF workers, copies CMaps/fonts, and includes pdf-lib/fflate MIT and PDF.js Apache-2.0 license notices. `scripts/pack.mjs` produces a deterministic ZIP.

## Verification

- Unit/component tests: real PDF stream compression and cleanup, retained forms/metadata, form flattening, attachments, 1-bit streams, rotated geometry, invalid/encrypted/XFA input, option validation, pixel budgets, monochrome packing, all locale keys/placeholders, file-first layout, Custom disclosure, nested drag feedback, PDF drops, native file selection, rejected multiple/non-PDF/empty/oversized drops, acknowledgement, stale results, processing cancellation and denied/cancelled saves.
- Built-package Chromium smoke: real workers and PDF drops inside an `allow-scripts` opaque-origin iframe with an emulated SDK host, corrupt replacement recovery, keyboard file actions, each compression preset, grayscale JPEG pixels, 1-bit output, form appearances, rotated/cropped pages, actual size comparisons, saved PDF reparsing, denied/cancelled saves, cancellation, 1280/768/390/320 px light/dark EN/DE/AR/HE layouts, expanded-options overflow checks, package assets, no outbound requests or uncaught page errors. Evidence is written to ignored `artifacts/`.
- Actual Shard installation, native permission/open/save dialogs, OS drag-and-drop interception, physical touch devices, screen-reader use, complex production PDFs and performance near the limits require separate host/device validation.
