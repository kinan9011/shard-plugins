# PDF Forms 1.0.0 validation

Implemented against Kanzo `shard-plugins#33` on branch `feat/pdf-forms`. The roadmap documents linked by that task are absent from the current checkout; the task's detailed specification and current acceptance table supplied the scope.

| Requirement | Evidence |
| --- | --- |
| List text, checkbox, choice and radio fields; names, types, required/read-only state | Unit inspection fixtures and real browser controls; dropdown, list and multi-select included |
| Fill/edit and preserve field values | Reopened saved PDFs with pdf-lib; canonical values and widget appearance streams asserted |
| JSON / CSV mapping and batch forms | Strict parser tests; browser file import and paste; independent ZIP members reopened and checked |
| Deliberate flattening | Confirmation and cancellation in browser; no AcroForm or Widget references after reopening; unrelated annotations preserved |
| Generated appearances and positioning | Actual PDF.js worker rendering in an opaque-origin iframe; page navigation and preview-to-field focus |
| Two independent viewers | PDF.js editor preview and Poppler render/text extraction for generated interactive and flattened PDFs |
| Shard integration | Unmodified shared SDK/bootstrap/locale/visibility source copies, optional file permissions, classic worker bundles and relative assets |
| Friendly failure recovery | Required-field validation; unknown/read-only/invalid mappings; XFA/encryption rejection; denied/cancelled saves preserve edits; worker startup cancellation and timeout cleanup |
| Responsive and localized design | Rendered 1280px light desktop, 1100px German dark desktop, 390px English touch, 360px Arabic dark RTL; Western digits, control bounds, reduced motion |
| Packaging | ZIP manifest, entry, both workers and dependency licenses checked; SHA-256 sidecar matches; repeated packaging produces identical bytes |

Checks passed:

- `npm run typecheck`
- `npm test`: 19 tests across engine/mapping and worker lifecycle
- `npm run build`
- `npm run test:browser`: complete sandbox workflow, Poppler verification, no unexpected outbound requests or missing assets
- `npm audit --omit=dev`: zero vulnerabilities
- `node --test tests/taskfile.test.mjs`: repository task routing passed
- Impeccable mechanical design scan: no findings; desktop, mobile RTL, dark and Poppler screenshots visually inspected

Package: `release/pdf-forms-1.0.0.zip` (2,529,087 bytes).

SHA-256: `835c129cc97089c8a04efa03ce76d00e6d1c254c8c6c8ff1e2105e3af495fb5e`.

Browser screenshots and PDFs are reproducible under ignored `artifacts/` after the browser command.

Remaining acceptance: native Shard installation/custom-scheme/CSP and actual OS dialogs/host shortcut routing; manual screen-reader/hardware touch; large and specialized real-world forms. Changed text uses Helvetica's Latin character set; unsupported characters fail explicitly. EN/DE/AR are translated; other app languages use English fallback. No release was published or installed in Shard.

Implementation references: [pdf-lib PDFForm](https://pdf-lib.js.org/docs/api/classes/pdfform), [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).
