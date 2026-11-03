# PDF Organizer

Merge, reorder, rotate, crop, split and export PDF pages locally in Shard, in the style of PDF Arranger. Nothing leaves your device and nothing is stored between sessions. Installation in the actual Shard app has not been verified yet (see the end of this file).

## Use

Open a PDF (**Open PDF**, Ctrl+O, or drop a file). Every page appears as a thumbnail in one grid; the toolbar has Open, Import, Save, Undo/Redo, Rotate left/right, Delete, a zoom slider and a **☰** menu with everything else. Right-click a page for the same actions, or Shift+F10 on a focused page. **?** (bottom right) lists every shortcut.

| Do this | Result |
| --- | --- |
| Click · Ctrl/Cmd+click · Shift+click | Select one page · toggle a page · select a range |
| Drag empty space | Selection box (Ctrl/Cmd adds). Escape cancels. |
| Drag a page or the selected group | Move it; a line shows the drop spot. Hold Ctrl at drop to copy. Escape cancels. Near the top or bottom edge the grid scrolls. |
| Touch | Tap toggles a page, press and hold then drag moves, swipe scrolls |
| Import (Ctrl+I) | Add PDFs/images after the selected page, or at the end with no selection |
| Drop files on a page | Insert after that page (on the background: append) |
| Ctrl+X / C / V · Ctrl+D · Delete | Cut / copy / paste after the selection · duplicate · delete |
| Ctrl+← / Ctrl+→ · Alt+← / Alt+→ | Rotate left / right · move the selection earlier / later |
| Ctrl+A · Ctrl+Shift+A | Select all · none (the menu also has odd, even and invert) |
| Insert | Blank page after the selection (size of its neighbour, A4 if unknown) |
| Ctrl+S | Save all pages as one PDF |
| +, −, 0 or Ctrl+wheel | Zoom the grid |

More actions are in the ☰ and right-click menus:

- **Crop…** hides a percentage of each side (repeatable), **Crop white borders** crops to the detected content, **Split pages…** cuts each page into columns × rows, **Scale…** resizes the saved page (10–400%), **Remove crop and scale** undoes those.
- **Merge pages…** places the selected pages side by side on new sheets (N-up, across-then-down or down-then-across).
- **Reverse**, **Export pages…** (selected or all pages; one PDF, one file per page, every N pages, or custom ranges such as `1-3;4-6;7,9`; several files save as a ZIP), **Document properties…** (title, author, subject, keywords written to saved files), **Import several files…**, **Clear session…**.

Every edit is one undo step (30 kept, including imports). Failed, cancelled or rejected actions leave the pages untouched.

**Save** and Ctrl+S always write every page as one PDF; the host's dialog chooses the name and location, so an original is only overwritten if you pick it there. The first save in a session (and the first after importing more files) shows what rebuilding changes; confirming it continues the save. Success is reported only after the host confirms the file was written.

Crop and scale are stored per page and applied when saving; **crop hides content, it does not delete it** (the removed area is still in the file).

## Boundaries

- All processing is on-device: no network permission, uploads, telemetry or CDN assets.
- 50 MiB per input/output file, 100 MiB retained source data per session (undo keeps sources until the session is cleared), 500 pages. Raster input is limited to 32 million pixels; JPEG orientation is honoured and images are placed at 96 dpi. Formats are detected by content, not extension.
- Import, assembly, merge and blank-page creation run in disposable workers with cancellation and a 60-second timeout. A batch import is atomic.
- Thumbnails use locally bundled PDF.js, CMaps and fonts, render lazily, and re-render at the zoom size and device pixel ratio (bounded to four million pixels per canvas). WASM and dynamic image decoders are disabled, so unusual image/font encodings can preview incompletely.
- Existing page boxes and rotation are kept; added rotation is a multiple of 90°. Cryptographic signatures are invalidated. Bookmarks and interactive form behaviour are not retained: form fields flatten to their existing appearances (missing appearances can fail export). Existing document properties are shown in **Document properties…** but are only written if you apply them. Annotations are copied; link annotations that point at other pages are stripped. XFA and encrypted PDFs are rejected without bypassing permissions.
- Merge cannot embed a page with no content stream; such a (blank) page leaves its cell empty.
- Bookmark-driven splitting, page-size presets for scaling and qpdf-based structure preservation are not included.
- **Why not a `<form>`:** the plugin frame is sandboxed without `allow-forms`, which silently disables form submit events, so dialogs use button handlers. For the same kind of reason, page dragging uses pointer events instead of HTML5 drag-and-drop, which embedded webviews can swallow. Only dropping *files from the OS* uses the native drop events.

## Build and verify

Requires Node 22.13+ (PDF.js dependency requirement; Node 20.19+ or 24+ also work).

```sh
cd pdf-organizer
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

`npm run dev` prepares the worker/assets and starts Vite; the native file input works outside Shard, host open/save need Shard. `npm run build` creates `dist/`, `release/pdf-organizer-1.1.0.zip` and its SHA-256 file. From the repository root, `task install|check|browser -- pdf-organizer` run the same commands (see the root README). The release workflow discovers the plugin by its manifest; `index.json` is release-managed.

`shared/pdf/limits.ts` holds the reusable input/range limits; `src/pdf/limits.ts` is its checked-in copy, refreshed when building inside this repository.

### What is checked

- **Unit/component tests** (`npm test`): real pdf-lib assembly (PDF+PNG merge, crop on pages with their own `/Rotate`, scale, N-up merge, blank page, properties, form flattening, link stripping, encrypted/XFA/malformed rejection, ZIP output), pure page operations (move, copy, insert, reverse, crop, split), and the full UI with mocked previews: toolbar, ☰ and context menus, every shortcut including inactive-tool and text-input cases, pointer drag with layout stubs (group, copy, cancel, long-press), selection, import placement, save acknowledgement/cancel/deny/busy, export dialog, crop/split/scale/merge/blank/properties dialogs, and thumbnail rendering at size/DPR/pixel budget.
- **Browser smoke** (`npm run test:browser`): the built package in an iframe with `sandbox="allow-scripts"` and an emulated SDK host in real Chromium: real mouse group drag with ghost and insertion line, Escape cancel, Ctrl-drop copy, edge autoscroll in a 40-page document, right-click menu at the pointer, keyboard shortcuts, zoom re-render, Ctrl+S with the saved PDF reparsed for order and rotation, import after a page, ZIP export, crop/white-border/split/merge/blank/properties with reparsed output, touch long-press drag and swipe-scroll, 1280/768/390 px light/dark with no overflow, and no outbound requests or page errors. Screenshots go to ignored `artifacts/`.
- Production dependencies: pdf-lib and fflate are MIT, PDF.js is Apache-2.0; notices ship in the package. PDF Arranger is GPL-3: this plugin implements the feature set from its public behaviour and shares no code with it.

### Not verified

Installation, permission prompts, native open/save dialogs, host shortcut routing, OS file drops (the host may intercept them; use Import), manual screen-reader use, physical touch devices, complex real-world signed/annotated/form PDFs and performance near 500 pages. The browser harness emulates the host and does not establish these.
