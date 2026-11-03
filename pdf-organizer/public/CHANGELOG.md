# Changelog

## 1.1.0

- Rebuilt around a PDF Arranger–style workspace: one icon toolbar, a full-size page grid with a zoom slider, a status bar, and a ☰ menu. The upload screen is a single Open PDF action.
- Page dragging now uses pointer events (mouse, pen and touch long-press), so reordering works inside embedded webviews where native drag-and-drop did not. Group moves, drop-line, Ctrl-drop copy, Escape cancel and edge autoscroll.
- Right-click (or Shift+F10) menus for pages and the background, and shortcuts for open, import, save, undo/redo, cut/copy/paste, duplicate, delete, rotate, move, select all/none, blank page and zoom.
- New page tools: rotate left, cut/copy/paste, reverse, select odd/even/invert, insert blank page, crop, crop white borders, split pages, scale, merge pages (N-up), document properties.
- Import after the selected page or a dropped-on page; Open replaces the session after confirmation. Export dialog for selected pages, per-page, every-N and range output (ZIP when several files).
- Save and Ctrl+S always write all pages as one PDF; the document-change warning is a one-time confirmation dialog. Dialogs no longer rely on form submission, which the plugin sandbox blocks.
- Removed per-page checkboxes and arrow buttons, the separate zoom preview pane, the file-order list and the Save options panel.

## 1.0.0

- Local PDF, PNG and JPEG import with page previews.
- Merge, reorder files/pages, rotate, duplicate, delete, extract, undo and redo.
- Split by ranges or every N pages and export PDF or ZIP.
- Explicit export acknowledgement for signature invalidation and document structure changes.
