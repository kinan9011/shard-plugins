import { useEffect, useReducer, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from "react";
import { sdk } from "./sdk";
import { ScrollRoot, Thumbnail } from "./Thumbnail";
import { Icon, type IconName } from "./icons";
import { Menu, type MenuItem } from "./Menu";
import { ConfirmDialog, ExportDialog, FieldsDialog, ShortcutsDialog, WarningDialog, defaultExport, type ExportOptions, type Field } from "./dialogs";
import { prepareInput, runEngine } from "./pdf/client";
import type { ImportResult, Metadata, Page, Source } from "./pdf/engine";
import { clonePages, cropPages, emptyHistory, historyReducer, insertPages, movePages, resetGeometry, reversePages, scalePages, setCrop, splitPages } from "./pdf/history";
import { MAX_FILE_BYTES, MAX_PAGES, MAX_SESSION_BYTES, everyNPages, parseRanges } from "./pdf/limits";
import { clearPreviews, contentBounds, pageSize } from "./pdf/preview";
import { usePageSelection } from "./hooks/usePageSelection";
import { usePageReorder, type Drop } from "./hooks/usePageReorder";
import { useToolActive } from "./hooks/useToolActive";

type Input = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };
type Dialog = { kind: "warning"; options: ExportOptions } | { kind: "export" } | { kind: "shortcuts" } | { kind: "crop" | "split" | "scale" | "merge" | "properties" } | { kind: "confirm"; title: string; body: string; label: string; run: () => void };
type MenuState = { x: number; y: number; kind: "main" | "page" | "background" };
const ZOOM = { min: 80, max: 400, step: 16, initial: 160 };
const plain = { ctrlKey: false, metaKey: false, shiftKey: false };
const plural = (count: number) => `${count} page${count === 1 ? "" : "s"}`;

export default function App() {
  const active = useToolActive();
  const root = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [history, dispatch] = useReducer(historyReducer, emptyHistory);
  const pages = history.pages;
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState("");
  const selection = usePageSelection(pages, !!busy);
  const { selected, setSelected } = selection;
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [thumb, setThumb] = useState(ZOOM.initial);
  const [clipboard, setClipboard] = useState<Page[]>([]);
  const [exportOptions, setExportOptions] = useState(defaultExport);
  const [metadata, setMetadata] = useState<Metadata>({});
  const [fileDropTarget, setFileDropTarget] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController>();
  const nativePicker = useRef<(files: Input[]) => void>();
  const lastSelectedFocus = useRef<string>();
  const touchSelection = useRef(false);
  const selectedPages = pages.filter(page => selected.has(page.id));
  const has = selectedPages.length > 0 && !busy;
  const canMoveEarlier = selectedPages.some((page, index) => page !== pages[index]);
  const canMoveLater = selectedPages.some((page, index) => page !== pages[pages.length - selectedPages.length + index]);
  if (selection.focused && selected.has(selection.focused)) lastSelectedFocus.current = selection.focused;
  const importAnchor = selected.has(lastSelectedFocus.current ?? "") ? lastSelectedFocus.current! : selectedPages[selectedPages.length - 1]?.id ?? null;
  const importHelp = importAnchor ? `Import after page ${pages.findIndex(page => page.id === importAnchor) + 1}` : "Import at the end";
  const activeSources = [...new Set(pages.map(page => page.sourceId))].map(id => sources.find(source => source.id === id)!);
  const reorder = usePageReorder({
    pages, selected, grid: selection.grid, scroller, busy: !!busy,
    selectOnly: id => selection.select(id, plain), commit: dropPages,
  });

  useEffect(() => () => { operation.current?.abort(); clearPreviews(); }, []);
  useEffect(() => { setFileDropTarget(null); }, [pages, busy]);
  useEffect(() => { if (!pages.length) { setMenu(null); } }, [pages.length]);
  useEffect(() => {
    const clear = () => setFileDropTarget(null);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") clear(); };
    window.addEventListener("drop", clear); window.addEventListener("dragend", clear);
    window.addEventListener("blur", clear); window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("drop", clear); window.removeEventListener("dragend", clear);
      window.removeEventListener("blur", clear); window.removeEventListener("keydown", escape);
    };
  }, []);

  function change(next: Page[], message = "") {
    if (next === pages) return;
    dispatch({ type: "set", pages: next });
    setNotice(message); setError("");
  }

  async function process(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(label); setError(""); setNotice("");
    try { await action(controller.signal); }
    catch (error) {
      if (controller.signal.aborted) setNotice("Cancelled. Your pages are unchanged.");
      else setError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      if (operation.current === controller) { operation.current = undefined; setBusy(""); }
    }
  }

  async function importFiles(files: Input[], signal: AbortSignal, anchorId: string | null, replace = false) {
    if (!files.length) return;
    const base = replace ? [] : pages;
    const position = anchorId === null ? base.length : base.findIndex(page => page.id === anchorId) + 1;
    if (anchorId !== null && !position) throw new Error("The import target is unavailable. Choose a page and try again.");
    if (files.length > MAX_PAGES) throw new Error("Import at most 500 files at a time.");
    const added: Source[] = [];
    const addedPages: Page[] = [];
    let bytes = replace ? 0 : sources.reduce((sum, source) => sum + source.bytes.length, 0);
    for (const file of files) {
      if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: choose a non-empty file up to 50 MiB.`);
      if (bytes + file.size > MAX_SESSION_BYTES) throw new Error("Keep this session under 100 MiB. Clear it to start a new batch.");
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      setBusy(`Reading ${file.name}…`);
      let result;
      try { result = await prepareInput(new Uint8Array(await file.arrayBuffer()), signal); }
      catch (error) { throw new Error(`${file.name}: ${error instanceof Error ? error.message : "could not import"}`); }
      bytes += result.bytes.length;
      if (bytes > MAX_SESSION_BYTES) throw new Error("Decoded documents exceed the 100 MiB session limit.");
      if (base.length + addedPages.length + result.count > MAX_PAGES) throw new Error("Keep at most 500 pages in the organizer.");
      const id = crypto.randomUUID();
      added.push({ id, name: file.name, ...result });
      for (let index = 0; index < result.count; index++) addedPages.push({ id: crypto.randomUUID(), sourceId: id, index, rotation: 0 });
    }
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const summary = `Added ${added.length} file(s), ${addedPages.length} page(s)`;
    if (replace) {
      clearPreviews(); selection.clear(); setClipboard([]); setMetadata({});
      setSources(added);
      dispatch({ type: "load", pages: addedPages });
      setNotice(`Opened ${summary.slice(6)}.`);
    } else {
      setSources(previous => [...previous, ...added]);
      change([...pages.slice(0, position), ...addedPages, ...pages.slice(position)],
        `${summary}${anchorId === null ? " at the end" : ` after page ${position}`}.`);
    }
    setAcknowledged(false);
  }

  const externalFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const fileTarget = (event: DragEvent) => (event.target as Element).closest<HTMLElement>("[data-page-id]")?.dataset.pageId ?? null;

  function overFiles(event: DragEvent) {
    if (!externalFiles(event)) return;
    event.preventDefault();
    if (operation.current) return;
    event.dataTransfer.dropEffect = "copy";
    setFileDropTarget(fileTarget(event));
  }

  function dropFiles(event: DragEvent) {
    if (!externalFiles(event)) return;
    event.preventDefault();
    setFileDropTarget(null);
    if (!event.dataTransfer.files.length || operation.current) return;
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);
    const anchorId = fileTarget(event);
    void process("Reading files…", signal => importFiles(files, signal, anchorId));
  }

  async function chooseFile(replace: boolean) {
    const anchorId = replace ? null : importAnchor;
    await process("Choosing a file…", async signal => {
      const file = await sdk.files.open({ as: "bytes", accept: ["pdf", "png", "jpg", "jpeg"] });
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (file) await importFiles([{ ...file, arrayBuffer: async () => new Uint8Array(file.bytes).buffer }], signal, anchorId, replace);
      else setNotice("No file selected. Your pages are unchanged.");
    });
  }

  async function chooseMultiple() {
    const anchorId = importAnchor;
    await process("Choosing files…", async signal => {
      const cancel = () => { nativePicker.current?.([]); nativePicker.current = undefined; };
      const abort = () => nativePicker.current?.([]);
      input.current!.addEventListener("cancel", cancel, { once: true });
      signal.addEventListener("abort", abort, { once: true });
      try {
        const files = await new Promise<Input[]>(resolve => {
          nativePicker.current = resolve;
          input.current!.click();
        });
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        if (files.length) await importFiles(files, signal, anchorId);
        else setNotice("No file selected. Your pages are unchanged.");
      } finally {
        input.current?.removeEventListener("cancel", cancel);
        signal.removeEventListener("abort", abort);
        // Consume a cancelled chooser's late change event without starting another import.
        if (!signal.aborted) nativePicker.current = undefined;
      }
    });
  }

  /** Open replaces the session, so it asks first, then picks a file; cancelling the picker keeps everything. */
  function open() {
    if (!pages.length) { void chooseFile(true); return; }
    setDialog({ kind: "confirm", title: "Open another PDF?", label: "Choose file…", run: () => void chooseFile(true),
      body: "Opening replaces the pages in this session and clears undo history. Use Import to add pages instead." });
  }

  function rotate(delta: number) {
    change(pages.map(page => selected.has(page.id) ? { ...page, rotation: (page.rotation + delta + 360) % 360 } : page), `Rotated ${plural(selectedPages.length)}.`);
  }

  function remove() { change(pages.filter(page => !selected.has(page.id)), `Deleted ${plural(selectedPages.length)}. Undo restores them.`); }

  function copy() { setClipboard(selectedPages); setNotice(`Copied ${plural(selectedPages.length)}.`); }

  function cut() { setClipboard(selectedPages); change(pages.filter(page => !selected.has(page.id)), `Cut ${plural(selectedPages.length)}. Paste puts them back.`); }

  function paste(after: boolean) {
    if (pages.length + clipboard.length > MAX_PAGES) { setError("Keep at most 500 pages in the organizer."); return; }
    const added = clonePages(clipboard);
    const edge = after ? selectedPages[selectedPages.length - 1] : selectedPages[0];
    change(insertPages(pages, added, edge?.id ?? null, after), `Pasted ${plural(added.length)}.`);
    setSelected(new Set(added.map(page => page.id)));
  }

  function duplicate() {
    change(pages.flatMap(page => selected.has(page.id) ? [page, { ...page, id: crypto.randomUUID() }] : [page]), `Duplicated ${plural(selectedPages.length)}.`);
  }

  function move(ids: Set<string>, direction: number) {
    const moving = pages.filter(page => ids.has(page.id));
    const edge = direction < 0 ? moving[0] : moving[moving.length - 1];
    const remaining = pages.filter(page => !ids.has(page.id));
    const target = pages[pages.indexOf(edge) + direction] ?? (direction < 0 ? remaining[0] : remaining[remaining.length - 1]);
    if (!edge || !target) return;
    change(movePages(pages, ids, target.id, direction > 0), `Moved ${plural(moving.length)}. Undo restores the previous order.`);
  }

  function dropPages(ids: Set<string>, drop: Drop, copying: boolean) {
    if (copying) {
      const moving = pages.filter(page => ids.has(page.id));
      if (pages.length + moving.length > MAX_PAGES) { setError("Keep at most 500 pages in the organizer."); return; }
      const added = clonePages(moving);
      change(insertPages(pages, added, drop.targetId, drop.after), `Copied ${plural(added.length)}.`);
      setSelected(new Set(added.map(page => page.id)));
    } else {
      const next = movePages(pages, ids, drop.targetId, drop.after);
      change(next, next === pages ? "" : `Moved ${plural(ids.size)}. Undo restores the previous order.`);
    }
  }

  const choose = (test: (page: Page, index: number) => boolean) => setSelected(new Set(pages.filter(test).map(page => page.id)));

  function clearSession() {
    dispatch({ type: "reset" }); setSources([]); selection.clear(); clearPreviews(); setClipboard([]); setMetadata({}); setThumb(ZOOM.initial);
    setNotice("Session cleared."); setError(""); setAcknowledged(false);
  }

  const suggestedName = () => {
    const stem = activeSources.length === 1 ? `${activeSources[0].name.replace(/\.[^.]*$/, "")}-organized` : "organized";
    return stem.replace(/[\x00-\x1f<>:"/\\|?*]/g, "_").replace(/^\.+|[.\s]+$/g, "").trim().slice(0, 100) || "organized";
  };

  function requestSave(options: ExportOptions = defaultExport) {
    if (!pages.length || operation.current) return;
    if (!acknowledged) { setDialog({ kind: "warning", options }); return; }
    void runSave(options);
  }

  async function runSave(options: ExportOptions) {
    await process("Building output…", async signal => {
      const subset = options.scope === "selected" ? pages.flatMap((page, index) => selected.has(page.id) ? [index] : []) : pages.map((_, index) => index);
      if (!subset.length) throw new Error("Select at least one page to export.");
      let local: number[][];
      if (options.mode === "ranges") local = parseRanges(options.ranges, subset.length);
      else if (options.mode === "every") local = everyNPages(subset.length, Number(options.every));
      else if (options.mode === "each") local = everyNPages(subset.length, 1);
      else local = [subset.map((_, index) => index)];
      const groups = local.map(group => group.map(index => subset[index]));
      const needed = new Set(groups.flatMap(group => group.map(index => pages[index].sourceId)));
      const result = await runEngine<{ bytes: Uint8Array; extension: string }>({ kind: "export", sources: sources.filter(source => needed.has(source.id)), pages, groups, metadata: Object.keys(metadata).length ? metadata : undefined }, signal);
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      setBusy("Saving…");
      const saved = await sdk.files.save(`${suggestedName()}.${result.extension}`, result.bytes);
      setNotice(saved ? `Saved ${groups.length} PDF file(s), ${groups.reduce((sum, group) => sum + group.length, 0)} page(s).` : "Save cancelled. Your pages are unchanged.");
    });
  }

  const sessionBytes = () => sources.reduce((sum, source) => sum + source.bytes.length, 0);
  const number = (value: string) => value.trim() === "" ? NaN : Number(value);

  /** Adds an engine-built document (blank page, merged sheets) as a new source and returns its pages. */
  function adopt(name: string, result: ImportResult) {
    if (sessionBytes() + result.bytes.length > MAX_SESSION_BYTES) throw new Error("Keep this session under 100 MiB. Clear it to start a new batch.");
    const id = crypto.randomUUID();
    setSources(previous => [...previous, { id, name, ...result }]);
    return Array.from({ length: result.count }, (_, index): Page => ({ id: crypto.randomUUID(), sourceId: id, index, rotation: 0 }));
  }

  function cropDialog(values: Record<string, string>) {
    const margins = ["left", "top", "right", "bottom"].map(side => number(values[side]));
    if (margins.some(value => !(value >= 0 && value <= 90))) return "Enter margins between 0 and 90 percent.";
    if (margins[0] + margins[2] > 95 || margins[1] + margins[3] > 95) return "Left plus right, and top plus bottom, must leave at least 5% visible.";
    if (margins.every(value => value === 0)) return "Enter a margin to remove.";
    setDialog(null);
    change(cropPages(pages, selected, margins.map(value => value / 100) as [number, number, number, number]), `Cropped ${plural(selectedPages.length)}. Cropping hides content; it does not delete it.`);
  }

  function splitDialog(values: Record<string, string>) {
    const [cols, rows] = [number(values.cols), number(values.rows)];
    if (![cols, rows].every(value => Number.isInteger(value) && value >= 1 && value <= 10) || cols * rows < 2) return "Choose 1–10 columns and rows, at least 2 pieces in total.";
    if (pages.length + selectedPages.length * (cols * rows - 1) > MAX_PAGES) return "Keep at most 500 pages in the organizer.";
    setDialog(null);
    const result = splitPages(pages, selected, cols, rows);
    change(result.pages, `Split ${plural(selectedPages.length)} into ${cols * rows} pieces each.`);
    setSelected(new Set(result.created));
  }

  function scaleDialog(values: Record<string, string>) {
    const percent = number(values.percent);
    if (!(percent >= 10 && percent <= 400)) return "Enter a scale between 10 and 400 percent.";
    setDialog(null);
    change(scalePages(pages, selected, percent / 100), `Scaled ${plural(selectedPages.length)} to ${percent}% when saved.`);
  }

  function propertiesDialog(values: Record<string, string>) {
    setMetadata(values);
    setDialog(null); setNotice("Properties will be written to saved files."); setError("");
  }

  function mergeDialog(values: Record<string, string>) {
    const [cols, rows] = [number(values.cols), number(values.rows)];
    if (![cols, rows].every(value => Number.isInteger(value) && value >= 1 && value <= 10) || cols * rows < 2) return "Choose 1–10 columns and rows, at least 2 pages per sheet.";
    setDialog(null);
    const chosen = selectedPages, order = values.order === "columns" ? "columns" : "rows";
    void process("Merging pages…", async signal => {
      const needed = new Set(chosen.map(page => page.sourceId));
      const result = await runEngine<ImportResult>({ kind: "merge", sources: sources.filter(source => needed.has(source.id)), pages: chosen, cols, rows, order }, signal);
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const sheets = adopt("Merged pages", result);
      const first = pages.findIndex(page => selected.has(page.id));
      const rest = pages.filter(page => !selected.has(page.id));
      if (rest.length + sheets.length > MAX_PAGES) throw new Error("Keep at most 500 pages in the organizer.");
      change([...rest.slice(0, first), ...sheets, ...rest.slice(first)], `Merged ${plural(chosen.length)} onto ${plural(sheets.length)}.`);
      setSelected(new Set(sheets.map(page => page.id)));
    });
  }

  function cropWhiteBorders() {
    const chosen = selectedPages;
    void process("Finding content…", async signal => {
      const found = new Map<string, Page>();
      for (const page of chosen) {
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const bounds = await contentBounds(sources.find(source => source.id === page.sourceId)!, page);
        if (bounds) found.set(page.id, setCrop(page, bounds));
      }
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (!found.size) throw new Error("The selected pages have no content to crop to.");
      change(pages.map(page => found.get(page.id) ?? page), `Cropped white borders on ${plural(found.size)}${found.size < chosen.length ? `; ${chosen.length - found.size} blank page(s) left as they were` : ""}.`);
    });
  }

  function insertBlank() {
    const anchor = selectedPages[selectedPages.length - 1] ?? pages[pages.length - 1];
    void process("Adding a blank page…", async signal => {
      let size: [number, number] = [595, 842];   // A4, when there is no page to copy the size from
      if (anchor) { try { size = await pageSize(sources.find(source => source.id === anchor.sourceId)!, anchor); } catch { /* keep A4 */ } }
      const result = await runEngine<ImportResult>({ kind: "blank", width: Math.round(size[0]), height: Math.round(size[1]) }, signal);
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (pages.length + 1 > MAX_PAGES) throw new Error("Keep at most 500 pages in the organizer.");
      const added = adopt("Blank page", result);
      change(insertPages(pages, added, anchor?.id ?? null, true), anchor ? `Inserted a blank page after page ${pages.indexOf(anchor) + 1}.` : "Inserted a blank page.");
      setSelected(new Set(added.map(page => page.id)));
    });
  }

  const geometryFields: Record<"crop" | "split" | "scale" | "merge" | "properties", { title: string; fields: Field[]; initial: Record<string, string>; submit: string; intro?: string; run: (values: Record<string, string>) => string | void }> = {
    crop: { title: "Crop pages", submit: "Crop", run: cropDialog, intro: "Percent of the page to hide on each side, as the page looks now. Repeat to crop further. The original file is not changed.",
      fields: [["left", "Left"], ["top", "Top"], ["right", "Right"], ["bottom", "Bottom"]].map(([key, label]) => ({ key, label: `${label} (%)`, min: 0, max: 90, step: 1 })), initial: { left: "0", top: "0", right: "0", bottom: "0" } },
    split: { title: "Split pages", submit: "Split", run: splitDialog, intro: "Cut each selected page into equal pieces, left to right and top to bottom.",
      fields: [{ key: "cols", label: "Columns", min: 1, max: 10, step: 1 }, { key: "rows", label: "Rows", min: 1, max: 10, step: 1 }], initial: { cols: "2", rows: "1" } },
    scale: { title: "Scale pages", submit: "Scale", run: scaleDialog, intro: "Enlarge or shrink the saved page and its content. Previews keep their size.",
      fields: [{ key: "percent", label: "Scale (%)", min: 10, max: 400, step: 5 }], initial: { percent: String(Math.round((selectedPages[0]?.scale ?? 1) * 100)) } },
    merge: { title: "Merge pages", submit: "Merge", run: mergeDialog, intro: "Place the selected pages side by side on new sheets. Each cell is as large as the largest selected page.",
      fields: [{ key: "cols", label: "Pages across", min: 1, max: 10, step: 1 }, { key: "rows", label: "Pages down", min: 1, max: 10, step: 1 },
        { key: "order", label: "Fill order", kind: "select", options: [["rows", "Across, then down"], ["columns", "Down, then across"]] }], initial: { cols: "2", rows: "1", order: "rows" } },
    properties: { title: "Document properties", submit: "Apply", run: propertiesDialog, intro: "Written to every file you save. Leave a field empty to clear it.",
      fields: (["title", "author", "subject", "keywords"] as const).map(key => ({ key, label: key[0].toUpperCase() + key.slice(1), kind: "text" as const, hint: key === "keywords" ? "Separate with commas." : undefined })),
      initial: Object.fromEntries((["title", "author", "subject", "keywords"] as const).map(key => [key, (Object.keys(metadata).length ? metadata : activeSources[0]?.report.info ?? {})[key] ?? ""])) },
  };

  type Act = { label: string; keys?: string; enabled: boolean; run: () => void; icon?: IconName };
  const idle = !busy;
  const act = (label: string, enabled: boolean, run: () => void, keys?: string, icon?: IconName): Act => ({ label, enabled: enabled && idle, run, keys, icon });
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const a = {
    open: act("Open…", true, open, `${mod}O`, "open"),
    import: act(importHelp, !!sources.length, () => void chooseFile(false), `${mod}I`, "import"),
    importMany: act("Import several files…", !!sources.length, () => void chooseMultiple()),
    save: act("Save", !!pages.length, () => requestSave(), `${mod}S`, "save"),
    export: act("Export pages…", !!pages.length, () => setDialog({ kind: "export" })),
    undo: act("Undo", !!history.past.length, () => dispatch({ type: "undo" }), `${mod}Z`, "undo"),
    redo: act("Redo", !!history.future.length, () => dispatch({ type: "redo" }), `${mod}Y`, "redo"),
    cut: act("Cut", has, cut, `${mod}X`, "cut"),
    copy: act("Copy", has, copy, `${mod}C`, "copy"),
    pasteAfter: act(selectedPages.length ? "Paste after" : "Paste at end", !!clipboard.length && !!sources.length, () => paste(true), `${mod}V`, "paste"),
    pasteBefore: act("Paste before", !!clipboard.length && has, () => paste(false)),
    duplicate: act("Duplicate", has && pages.length + selectedPages.length <= MAX_PAGES, duplicate, `${mod}D`),
    remove: act("Delete", has, remove, "Del", "trash"),
    rotateLeft: act("Rotate left", has, () => rotate(-90), `${mod}←`, "rotateLeft"),
    rotateRight: act("Rotate right", has, () => rotate(90), `${mod}→`, "rotateRight"),
    reverse: act(selectedPages.length > 1 ? "Reverse selected order" : "Reverse all pages", pages.length > 1, () => change(reversePages(pages, selected), "Reversed page order.")),
    earlier: act("Move earlier", has && canMoveEarlier, () => move(selected, -1), "Alt+←"),
    later: act("Move later", has && canMoveLater, () => move(selected, 1), "Alt+→"),
    selectAll: act("Select all", !!pages.length, () => choose(() => true), `${mod}A`),
    selectNone: act("Select none", !!selectedPages.length, selection.clear, `${mod}⇧A`),
    selectOdd: act("Select odd pages", !!pages.length, () => choose((_, index) => index % 2 === 0)),
    selectEven: act("Select even pages", pages.length > 1, () => choose((_, index) => index % 2 === 1)),
    selectInvert: act("Invert selection", !!pages.length, () => choose(page => !selected.has(page.id))),
    zoomIn: act("Zoom in", thumb < ZOOM.max, () => setThumb(size => Math.min(ZOOM.max, size + ZOOM.step)), "+", "plus"),
    zoomOut: act("Zoom out", thumb > ZOOM.min, () => setThumb(size => Math.max(ZOOM.min, size - ZOOM.step)), "−", "minus"),
    zoomReset: act("Reset zoom", thumb !== ZOOM.initial, () => setThumb(ZOOM.initial), "0"),
    crop: act("Crop…", has, () => setDialog({ kind: "crop" })),
    cropWhite: act("Crop white borders", has, cropWhiteBorders),
    split: act("Split pages…", has, () => setDialog({ kind: "split" })),
    scale: act("Scale…", has, () => setDialog({ kind: "scale" })),
    resetGeometry: act("Remove crop and scale", has && selectedPages.some(page => page.crop || page.scale), () => change(resetGeometry(pages, selected), `Restored ${plural(selectedPages.length)} to full size.`)),
    merge: act("Merge pages…", has && selectedPages.length > 1, () => setDialog({ kind: "merge" })),
    blank: act("Insert blank page", !!sources.length, insertBlank, "Ins"),
    properties: act("Document properties…", !!pages.length, () => setDialog({ kind: "properties" })),
    shortcuts: act("Shortcuts…", true, () => setDialog({ kind: "shortcuts" }), "?"),
    clear: act("Clear session…", !!sources.length, () => setDialog({ kind: "confirm", title: "Clear this session?", label: "Clear session", run: clearSession,
      body: "All pages and undo history are removed. Your original files are not changed." })),
  };
  const item = (id: keyof typeof a): MenuItem => ({ id, label: a[id].label, keys: a[id].keys, disabled: !a[id].enabled, run: a[id].run });
  const items: Record<MenuState["kind"], MenuItem[]> = {
    main: [item("open"), item("import"), item("importMany"), item("save"), item("export"), "separator", item("undo"), item("redo"), "separator",
      item("cut"), item("copy"), item("pasteAfter"), item("pasteBefore"), item("duplicate"), item("remove"), "separator",
      item("rotateLeft"), item("rotateRight"), item("reverse"), item("earlier"), item("later"), "separator",
      item("crop"), item("cropWhite"), item("split"), item("scale"), item("resetGeometry"), item("merge"), item("blank"), item("properties"), "separator",
      item("selectAll"), item("selectNone"), item("selectOdd"), item("selectEven"), item("selectInvert"), "separator",
      item("zoomIn"), item("zoomOut"), item("zoomReset"), "separator", item("shortcuts"), item("clear")],
    page: [item("cut"), item("copy"), item("pasteBefore"), item("pasteAfter"), item("duplicate"), item("remove"), "separator",
      item("rotateLeft"), item("rotateRight"), item("reverse"), "separator",
      item("crop"), item("cropWhite"), item("split"), item("scale"), item("resetGeometry"), item("merge"), "separator", item("blank"), item("export"), "separator", item("selectAll")],
    background: [item("pasteAfter"), item("import"), item("blank"), "separator", item("selectAll")],
  };

  // The latest actions are read on each key press; the listener is rebuilt per render so it never sees stale state.
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target !== document.body && !root.current?.contains(target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && !event.altKey && !event.shiftKey && key === "s") {
        event.preventDefault();
        if (!event.repeat && !dialog && !menu) requestSave();
        return;
      }
      if (event.defaultPrevented || dialog || menu || target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        const card = target?.closest<HTMLElement>("[data-page-id]");
        if (!card || busy) return;
        event.preventDefault();
        if (!selected.has(card.dataset.pageId!)) selection.select(card.dataset.pageId!, plain);
        const box = card.getBoundingClientRect();
        setMenu({ x: box.left + box.width / 2, y: box.top + box.height / 2, kind: "page" });
        return;
      }
      let action: Act | undefined;
      if (mod && !event.altKey) {
        const keys: Record<string, Act> = { o: a.open, i: a.import, z: event.shiftKey ? a.redo : a.undo, y: a.redo, x: a.cut, c: a.copy, v: a.pasteAfter, d: a.duplicate,
          a: event.shiftKey ? a.selectNone : a.selectAll, arrowleft: a.rotateLeft, arrowright: a.rotateRight };
        if (key === "a" || !event.shiftKey || key === "z") action = keys[key];
      } else if (event.altKey && !mod) {
        action = { arrowleft: a.earlier, arrowright: a.later }[key];
      } else if (!mod) {
        action = ({ delete: a.remove, backspace: a.remove, insert: a.blank, "+": a.zoomIn, "=": a.zoomIn, "-": a.zoomOut, _: a.zoomOut, "0": a.zoomReset, "?": a.shortcuts } as Record<string, Act>)[key];
      }
      if (!action) return;
      event.preventDefault();
      if (action.enabled && !event.repeat) action.run();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  function contextMenu(event: MouseEvent) {
    const target = event.target as Element;
    if (target.closest("input, textarea")) return;
    event.preventDefault();
    if (busy || reorder.active() || !pages.length || target.closest(".menu, dialog")) return;
    const card = target.closest<HTMLElement>("[data-page-id]");
    if (card) {
      if (!selected.has(card.dataset.pageId!)) selection.select(card.dataset.pageId!, plain);
      setMenu({ x: event.clientX, y: event.clientY, kind: "page" });
    } else if (target.closest(".grid-scroll")) setMenu({ x: event.clientX, y: event.clientY, kind: "background" });
  }

  const dragNote = fileDropTarget ? `Insert after page ${pages.findIndex(page => page.id === fileDropTarget) + 1}`
    : reorder.dragging.size ? `Moving ${plural(reorder.dragging.size)}${reorder.marker ? reorder.marker.position === 0 ? " to the start" : reorder.marker.position === pages.length ? " to the end" : ` before page ${reorder.marker.position + 1}` : ". Drop at an insertion line; Esc cancels."}` : "";
  const workspace = !!sources.length;
  const button = (id: keyof typeof a, name = a[id].label, extra = "") => <button type="button" className={`icon${extra}`} disabled={!a[id].enabled}
    aria-label={name} title={a[id].keys ? `${a[id].label} (${a[id].keys})` : a[id].label} onClick={a[id].run}>{a[id].icon && <Icon name={a[id].icon!} />}</button>;

  return <main ref={root} className="organizer" onContextMenu={contextMenu} onDragOver={overFiles} onDrop={dropFiles}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileDropTarget(null); }} aria-busy={!!busy}>
    <h1 className="sr-only">PDF Organizer</h1>
    <input ref={input} type="file" aria-label="Import PDFs or images" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" multiple hidden onChange={event => {
        const files = Array.from(event.target.files ?? []); event.target.value = "";
        if (nativePicker.current) { const finish = nativePicker.current; nativePicker.current = undefined; finish(files); return; }
        if (!files.length) return;
        const anchorId = importAnchor;
        void process("Reading files…", signal => importFiles(files, signal, anchorId));
      }} />
    {workspace && <div className="toolbar" role="toolbar" aria-label="Page tools">
      {button("open", "Open")}{button("import", "Import")}{button("save", "Save")}<span className="divider" />
      {button("undo")}{button("redo")}<span className="divider" />
      {button("rotateLeft")}{button("rotateRight")}{button("remove")}<span className="divider" />
      {button("zoomOut")}
      <input type="range" aria-label="Zoom" min={ZOOM.min} max={ZOOM.max} step={ZOOM.step} value={thumb} disabled={!pages.length} onChange={event => setThumb(Number(event.target.value))} />
      {button("zoomIn")}<span className="spacer" />
      <button type="button" className="icon" aria-label="More actions" title="More actions" aria-haspopup="menu" aria-expanded={menu?.kind === "main"}
        onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ x: box.right - 240, y: box.bottom + 4, kind: "main" }); }}><Icon name="menu" /></button>
    </div>}
    {!pages.length ? <section className="import-zone" aria-labelledby="upload-title">
      <h2 id="upload-title">{workspace ? "No pages left" : "Drop your PDF here"}</h2>
      <p>{workspace ? "Undo to restore your pages, or open another file." : "PDF, PNG or JPEG · up to 50 MiB per file · nothing leaves your device"}</p>
      <button type="button" className="primary" disabled={!!busy} onClick={() => void chooseFile(true)}>Open PDF</button>
      <button type="button" className="link" disabled={!!busy} onClick={() => void chooseMultiple()}>Choose several files</button>
    </section> : <ScrollRoot.Provider value={scroller}><div ref={scroller} className="grid-scroll">
      <ol ref={selection.grid} className="page-grid" role="grid" aria-multiselectable="true" aria-disabled={!!busy} aria-label="Pages in output order"
        style={{ "--thumb": `${thumb}px` } as CSSProperties}
        onClick={event => { if (!busy && event.target === event.currentTarget && "pointerType" in event.nativeEvent && event.nativeEvent.pointerType === "touch") selection.clear(); }}
        onPointerDown={selection.pointerDown} onPointerMove={selection.pointerMove}
        onPointerUp={event => { if (event.isPrimary) selection.finish(); }}
        onPointerCancel={() => selection.finish(true)} onLostPointerCapture={() => selection.finish(true)}
        onWheel={event => { if (event.ctrlKey) { setThumb(size => Math.max(ZOOM.min, Math.min(ZOOM.max, size - Math.sign(event.deltaY) * ZOOM.step))); } }}>
        {pages.map((page, index) => {
          const source = sources.find(source => source.id === page.sourceId)!;
          return <li key={page.id} role="row" aria-label={`Page ${index + 1}`} aria-selected={selected.has(page.id)} data-page-id={page.id}
            className={`page-card${selected.has(page.id) ? " selected" : ""}${reorder.dragging.has(page.id) ? " dragging" : ""}${fileDropTarget === page.id ? " file-insert-target" : ""}`}
            onPointerDown={event => { touchSelection.current = event.pointerType === "touch"; reorder.down(event, page.id); }}
            onClick={event => { if (reorder.consumeClick()) return; event.currentTarget.querySelector<HTMLElement>(".page-select")?.focus(); selection.select(page.id, event, touchSelection.current); }}>
            <div role="gridcell" className="page-select" aria-label={`Select page ${index + 1}`} tabIndex={!busy && (selection.focused ?? pages[0]?.id) === page.id ? 0 : -1}
              onFocus={() => selection.setFocused(page.id)} onKeyDown={event => selection.keyDown(event, page.id)}>
              <Thumbnail source={source} page={page} size={thumb} />
              <span className="page-number">{index + 1}</span>
              <p className="page-source" title={`${source.name}, original page ${page.index + 1}`}>{source.name} · {page.index + 1}{page.scale ? ` · ${Math.round(page.scale * 100)}%` : ""}</p>
            </div>
          </li>;
        })}
        {selection.rectangle && <li role="presentation" className="selection-rectangle" style={selection.rectangle} />}
        {reorder.marker && <li role="presentation" className="page-insertion-marker" style={{ left: reorder.marker.left, top: reorder.marker.top, height: reorder.marker.height }} />}
      </ol>
    </div></ScrollRoot.Provider>}
    <footer className="status">
      <span className="count">{pages.length ? `${plural(pages.length)} · ${selectedPages.length} selected` : ""}</span>
      <span className="feedback" aria-live="polite">{busy ? <>{busy} {busy !== "Saving…" && <button type="button" onClick={() => operation.current?.abort()}>Cancel processing</button>}</> : dragNote || notice}</span>
      <button type="button" className="link" onClick={a.shortcuts.run} aria-label="Shortcuts and help" title="Shortcuts (?)">?</button>
    </footer>
    {error && <p className="error" role="alert">{error}</p>}
    {reorder.ghost && <div className="drag-ghost" style={{ left: reorder.ghost.x + 14, top: reorder.ghost.y + 14 }}>{plural(reorder.ghost.count)}</div>}
    {menu && <Menu items={items[menu.kind]} x={menu.x} y={menu.y} label={menu.kind === "main" ? "More actions" : "Page actions"} onClose={() => setMenu(null)} />}
    {dialog?.kind === "warning" && <WarningDialog sources={activeSources} onCancel={() => setDialog(null)}
      onConfirm={() => { const { options } = dialog; setAcknowledged(true); setDialog(null); void runSave(options); }} />}
    {dialog?.kind === "export" && <ExportDialog initial={{ ...exportOptions, scope: selectedPages.length ? "selected" : "all" }} selectedCount={selectedPages.length} total={pages.length}
      onCancel={() => setDialog(null)} onExport={options => { setExportOptions(options); setDialog(null); requestSave(options); }} />}
    {dialog && dialog.kind in geometryFields && <FieldsDialog {...geometryFields[dialog.kind as keyof typeof geometryFields]} onCancel={() => setDialog(null)} onSubmit={geometryFields[dialog.kind as keyof typeof geometryFields].run} />}
    {dialog?.kind === "shortcuts" && <ShortcutsDialog onCancel={() => setDialog(null)} />}
    {dialog?.kind === "confirm" && <ConfirmDialog title={dialog.title} body={dialog.body} label={dialog.label} onCancel={() => setDialog(null)}
      onConfirm={() => { const { run } = dialog; setDialog(null); run(); }} />}
  </main>;
}
