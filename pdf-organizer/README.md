# PDF Organizer

Implementation of Kanzo `shard-plugins#28` on `feat/pdf-organizer`. The current roadmap's organizer scope is implemented; actual Shard installation acceptance remains pending.

## Use

Add PDFs, PNGs or JPEGs through **Open file** (Shard's dialog), **Choose multiple files**, or drag-and-drop. Arrange files or individual pages by dragging, or use the labeled arrow buttons with a keyboard. Select pages individually or by a range such as `1-3,5`, then rotate, duplicate or delete. With no selection, rotation applies to every page. Undo/redo retains the last 30 edits, including imports. Clear session releases the originals and previews and cannot be undone.

Export all pages or extract the selection as one PDF. Split by current page ranges (`1-3;4-6;7,9`) or every N pages. One piece saves as a PDF; multiple pieces save as an ordered ZIP. Export requires acknowledging the document changes, then granting Shard's file-save permission. The originals remain unchanged unless you explicitly choose an original file as the save destination in the host dialog.

## Supported boundaries

- All document processing stays on the device. No network permission, uploads, telemetry, document persistence, or CDN assets. Closing/reloading the plugin loses the session.
- 50 MiB per input/output file, 100 MiB retained source data per session, 500 editable/output pages. Undo keeps source bytes until the session is cleared. Raster input is limited to 32 million pixels; browser decoding respects JPEG orientation and embeds images at 96 dpi. Unsupported formats are rejected by content rather than extension.
- Import and assembly run in disposable workers with cancellation and a 60-second timeout. A batch import is atomic: a failure or cancellation adds no partial batch. The save dialog is controlled by the host after processing completes.
- Previews use locally bundled PDF.js, CMaps and standard fonts, a classic worker loaded through the unchanged Shard SDK, and lazy rendering while visible. WASM and dynamic image decoders are disabled; advanced image/font encodings may produce incomplete previews. Rendering errors appear on the affected page.
- PDF page media/crop boxes and existing rotation are retained during assembly. Additional rotations are multiples of 90 degrees. Images become independent pages.
- Cryptographic signatures are invalidated. Source signature detection is informational, not verification. Bookmarks, document metadata and interactive form behavior are not retained. Form fields flatten to existing appearances; forms with missing/unsupported appearances can fail export rather than silently lose values. XFA and encrypted PDFs are rejected without bypassing encryption or permissions.
- Page annotations are copied. A text-note fixture verifies retention; this does not establish compatibility for every annotation type, navigation action or PDF reader. Test important outputs in your reader before using them. Arbitrary input PDFs are not sanitized for use in other applications.
- Bookmark-driven splitting and qpdf-based structure preservation from the earlier specification are deferred under the current roadmap. This plugin provides range/single-page/every-N splitting and explicitly reports document structure changes.

## Build and verify

Requires Node 22.13+ (PDF.js dependency requirement).

```sh
cd pdf-organizer
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

`npm run dev` prepares the worker/assets and starts Vite. Native file input works outside Shard; host open/save calls require Shard. `npm run build` creates `dist/`, `release/pdf-organizer-1.0.0.zip` and its SHA-256 file. The release workflow discovers the plugin by its manifest; `index.json` remains release-managed. No release or remote push is performed by this implementation.

`shared/pdf/limits.ts` contains reusable input/range limits. Its checked-in copy at `src/pdf/limits.ts` is refreshed by preparation when building inside this repository. Both copies ship in source so this plugin also builds on its own. Other plugins need no changes. SDK, bootstrap, storage shim, theme preset and packaging follow the existing template.

Verified locally:

- 32 unit/component tests: real PDF+PNG assembly, geometry/crop/rotation, duplicates/extraction, ZIP contents, form appearance flattening, text-note retention, outline/signature reporting, encrypted/XFA rejection, malformed/oversized input, ranges, history, cancellation/timeout, denied/cancelled saves.
- TypeScript check and production build/ZIP pass. Vite reports the PDF.js main bundle exceeds its 500 kB chunk warning threshold; the package remains about 2.3 MB compressed.
- Browser smoke against the built package in an iframe with `sandbox="allow-scripts"` and an emulated SDK host: real preview workers/canvas pixels, keyboard ordering, page/file drag-and-drop, PDF geometry after export, PNG+JPEG merge, ZIP reparse, denied save, 1280/768/390 px overflow checks, light/dark screenshots. No unexpected HTTP requests, missing assets or page errors. Screenshots are written to ignored `artifacts/`.
- Production dependency audit reports zero known vulnerabilities at implementation time. pdf-lib and fflate are MIT; PDF.js is Apache-2.0. Their notices and bundled font/CMap notices are included in the built package.

Remaining acceptance: install/uninstall/restart and permission prompts in the actual Shard app (including its custom asset scheme/CSP), native save behavior, OS file drag-and-drop, manual screen-reader use, complex real-world annotations/forms/signed files, and performance near the stated limits. The browser harness emulates the host and does not establish these results.
