import { useEffect, useReducer, useRef, useState, type DragEvent } from "react";
import { sdk } from "./sdk";
import { Thumbnail } from "./Thumbnail";
import { prepareInput, runEngine } from "./pdf/client";
import type { Page, Source } from "./pdf/engine";
import { emptyHistory, historyReducer, movePage, moveSource } from "./pdf/history";
import { MAX_FILE_BYTES, MAX_PAGES, MAX_SESSION_BYTES, everyNPages, parseRanges } from "./pdf/limits";
import { clearPreviews } from "./pdf/preview";

const PAGE_DRAG = "application/x-shard-pdf-page";
const SOURCE_DRAG = "application/x-shard-pdf-source";
type Input = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

export default function App() {
  const [history, dispatch] = useReducer(historyReducer, emptyHistory);
  const pages = history.pages;
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [range, setRange] = useState("");
  const [mode, setMode] = useState("all");
  const [splitRange, setSplitRange] = useState("");
  const [chunkSize, setChunkSize] = useState("1");
  const [fileName, setFileName] = useState("organized");
  const [acknowledged, setAcknowledged] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController>();
  const selectedPages = pages.filter(page => selected.has(page.id));
  const activeSources = [...new Set(pages.map(page => page.sourceId))].map(id => sources.find(source => source.id === id)!);

  useEffect(() => () => { operation.current?.abort(); clearPreviews(); }, []);

  function change(next: Page[]) {
    if (next === pages) return;
    dispatch({ type: "set", pages: next });
    setNotice(""); setError("");
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

  async function importFiles(files: Input[], signal: AbortSignal) {
    if (!files.length) return;
    if (files.length > MAX_PAGES) throw new Error("Import at most 500 files at a time.");
    const added: Source[] = [];
    const addedPages: Page[] = [];
    let bytes = sources.reduce((sum, source) => sum + source.bytes.length, 0);
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
      if (pages.length + addedPages.length + result.count > MAX_PAGES) throw new Error("Keep at most 500 pages in the organizer.");
      const id = crypto.randomUUID();
      added.push({ id, name: file.name, ...result });
      for (let index = 0; index < result.count; index++) addedPages.push({ id: crypto.randomUUID(), sourceId: id, index, rotation: 0 });
    }
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    setSources(previous => [...previous, ...added]);
    change([...pages, ...addedPages]);
    setAcknowledged(false);
    setNotice(`Added ${added.length} file(s), ${addedPages.length} page(s).`);
  }

  function dropFiles(event: DragEvent) {
    event.preventDefault();
    if (!event.dataTransfer.files.length || operation.current) return;
    const files = Array.from(event.dataTransfer.files);
    void process("Reading files…", signal => importFiles(files, signal));
  }

  async function openFromHost() {
    await process("Choosing a file…", async signal => {
      const file = await sdk.files.open({ as: "bytes", accept: ["pdf", "png", "jpg", "jpeg"] });
      if (file && !signal.aborted) await importFiles([{ ...file, arrayBuffer: async () => new Uint8Array(file.bytes).buffer }], signal);
    });
  }

  function rotate() {
    change(pages.map(page => !selectedPages.length || selected.has(page.id) ? { ...page, rotation: (page.rotation + 90) % 360 } : page));
  }

  function selectRange() {
    try {
      const groups = parseRanges(range, pages.length);
      if (groups.length !== 1) throw new Error("Use commas for one selection, such as 1-3,5.");
      setSelected(new Set(groups[0].map(index => pages[index].id)));
      setError("");
    } catch (error) { setError((error as Error).message); }
  }

  async function save() {
    if (!acknowledged) { setError("Acknowledge the document changes before exporting."); return; }
    await process("Building output…", async signal => {
      let groups: number[][];
      if (mode === "ranges") groups = parseRanges(splitRange, pages.length);
      else if (mode === "every") groups = everyNPages(pages.length, Number(chunkSize));
      else if (mode === "selected") {
        if (!selectedPages.length) throw new Error("Select at least one page to extract.");
        groups = [pages.flatMap((page, index) => selected.has(page.id) ? [index] : [])];
      } else groups = [pages.map((_, index) => index)];
      const needed = new Set(groups.flatMap(group => group.map(index => pages[index].sourceId)));
      const result = await runEngine<{ bytes: Uint8Array; extension: string }>({ kind: "export", sources: sources.filter(source => needed.has(source.id)), pages, groups }, signal);
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      setBusy("Saving…");
      const name = fileName.replace(/[\x00-\x1f<>:"/\\|?*]/g, "_").replace(/\.(pdf|zip)$/i, "").replace(/^\.+|[.\s]+$/g, "").trim().slice(0, 100) || "organized";
      const saved = await sdk.files.save(`${name}.${result.extension}`, result.bytes);
      setNotice(saved ? `Saved ${groups.length} PDF file(s), ${groups.reduce((sum, group) => sum + group.length, 0)} page(s).` : "Save cancelled. Your pages are unchanged.");
    });
  }

  return <main className="organizer" onDragOver={event => event.preventDefault()} onDrop={dropFiles} aria-busy={!!busy}>
    <header className="heading"><div><h1>PDF Organizer</h1><p>Bring your pages together. Keep the originals.</p></div><span className="local-label">Local processing</span></header>
    <section className="import-zone" aria-label="Import files">
      <div><h2>Add PDFs or images</h2><p>Drop PDF, PNG or JPEG files here. Up to 50 MiB per file, 100 MiB per session and 500 pages. Images use 96 dpi, up to 32 million pixels.</p></div>
      <div className="actions"><button type="button" className="primary" disabled={!!busy} onClick={() => void openFromHost()}>Open file</button><button type="button" disabled={!!busy} onClick={() => input.current?.click()}>Choose multiple files</button></div>
      <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" multiple hidden onChange={event => {
        const files = Array.from(event.target.files ?? []); event.target.value = "";
        void process("Reading files…", signal => importFiles(files, signal));
      }} />
    </section>
    <div className="feedback" aria-live="polite">{busy && <span>{busy} {busy !== "Saving…" && <button type="button" onClick={() => operation.current?.abort()}>Cancel processing</button>}</span>}{notice && <span>{notice}</span>}</div>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="workspace" aria-label="Organize pages">
      <div className="section-heading"><h2>{pages.length ? `${pages.length} pages · ${activeSources.length} files` : "Your pages"}</h2><div className="actions">
        <button type="button" disabled={!!busy || !history.past.length} onClick={() => dispatch({ type: "undo" })}>Undo</button>
        <button type="button" disabled={!!busy || !history.future.length} onClick={() => dispatch({ type: "redo" })}>Redo</button>
        <button type="button" disabled={!!busy || !sources.length} onClick={() => { dispatch({ type: "reset" }); setSources([]); setSelected(new Set()); clearPreviews(); setNotice("Session cleared."); setError(""); setAcknowledged(false); }}>Clear session</button>
      </div></div>
      {!pages.length ? <p className="empty">Add your files to preview and arrange pages. Original files are never overwritten automatically. Nothing is stored between sessions.</p> : <>
        <ol className="sources" aria-label="File order">{activeSources.map((source, index) => <li key={source.id} draggable={!busy}
          onDragStart={event => event.dataTransfer.setData(SOURCE_DRAG, source.id)}
          onDrop={event => { const id = event.dataTransfer.getData(SOURCE_DRAG); if (id && !busy) { event.preventDefault(); event.stopPropagation(); change(moveSource(pages, id, source.id)); } }}>
          <span title={source.name}>{source.name}</span><small>{pages.filter(page => page.sourceId === source.id).length} pages</small>
          <button type="button" disabled={!!busy || index === 0} aria-label={`Move file ${source.name} earlier`} onClick={() => change(moveSource(pages, source.id, activeSources[index - 1].id))}>↑</button>
          <button type="button" disabled={!!busy || index === activeSources.length - 1} aria-label={`Move file ${source.name} later`} onClick={() => change(moveSource(pages, source.id, activeSources[index + 1].id))}>↓</button>
        </li>)}</ol>
        <p className="hint">Drag files or pages to reorder. The arrow buttons also work with a keyboard. File moves group their pages together.</p>
        <fieldset className="toolbar" disabled={!!busy}>
          <legend className="sr-only">Page actions</legend>
          <label className="select-all"><input type="checkbox" checked={selectedPages.length === pages.length} onChange={event => setSelected(event.target.checked ? new Set(pages.map(page => page.id)) : new Set())} />Select all</label>
          <span>{selectedPages.length} selected</span>
          <button type="button" onClick={rotate}>Rotate {selectedPages.length ? "selected" : "all"} 90°</button>
          <button type="button" disabled={!selectedPages.length || pages.length + selectedPages.length > MAX_PAGES} onClick={() => change(pages.flatMap(page => selected.has(page.id) ? [page, { ...page, id: crypto.randomUUID() }] : [page]))}>Duplicate selected</button>
          <button type="button" disabled={!selectedPages.length} onClick={() => change(pages.filter(page => !selected.has(page.id)))}>Delete selected</button>
          <div className="range-selection"><label htmlFor="page-range">Select pages</label><input id="page-range" placeholder="1-3,5" value={range} onChange={event => setRange(event.target.value)} /><button type="button" onClick={selectRange}>Apply selection</button></div>
        </fieldset>
        <ol className="page-grid" aria-label="Pages in output order">{pages.map((page, index) => {
          const source = sources.find(source => source.id === page.sourceId)!;
          return <li key={page.id} className={`page-card${selected.has(page.id) ? " selected" : ""}`} draggable={!busy}
            onDragStart={event => event.dataTransfer.setData(PAGE_DRAG, page.id)}
            onDrop={event => { const id = event.dataTransfer.getData(PAGE_DRAG); if (id && !busy) { event.preventDefault(); event.stopPropagation(); change(movePage(pages, id, index)); } }}>
            <label className="page-select"><input type="checkbox" disabled={!!busy} checked={selected.has(page.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(page.id); else next.delete(page.id); return next; })} />Page {index + 1}</label>
            <Thumbnail source={source} page={page} />
            <p className="page-source" title={`${source.name}, original page ${page.index + 1}`}>{source.name} · {page.index + 1}</p>
            <div className="page-controls"><button type="button" disabled={!!busy || index === 0} aria-label={`Move page ${index + 1} earlier`} onClick={() => change(movePage(pages, page.id, index - 1))}>←</button><button type="button" disabled={!!busy || index === pages.length - 1} aria-label={`Move page ${index + 1} later`} onClick={() => change(movePage(pages, page.id, index + 1))}>→</button></div>
          </li>;
        })}</ol>
      </>}
    </section>
    <section className="export-panel" aria-labelledby="export-title">
      <h2 id="export-title">Export your pages</h2>
      <fieldset disabled={!!busy || !pages.length} className="export-options"><legend className="sr-only">Export settings</legend>
        <div className="form-field"><label htmlFor="export-mode">Output</label><select id="export-mode" value={mode} onChange={event => setMode(event.target.value)}><option value="all">All pages as one PDF</option><option value="selected">Extract selected pages</option><option value="ranges">Split by page ranges</option><option value="every">Split every N pages</option></select></div>
        {mode === "ranges" && <div className="range-output"><label htmlFor="split-range">Ranges</label><input id="split-range" aria-describedby="range-help" value={splitRange} onChange={event => setSplitRange(event.target.value)} placeholder="1-3;4-6;7,9" /><small id="range-help">Use current page numbers. Semicolons start separate files; commas join pages.</small></div>}
        {mode === "every" && <div className="form-field"><label htmlFor="chunk-size">Pages per file</label><input id="chunk-size" type="number" min="1" max="500" step="1" value={chunkSize} onChange={event => setChunkSize(event.target.value)} /></div>}
        <div className="form-field"><label htmlFor="file-name">File name</label><input id="file-name" value={fileName} onChange={event => setFileName(event.target.value)} maxLength={100} /></div>
      </fieldset>
      <div className="document-warning"><h3>Before you save</h3><p>Editing rebuilds the PDF and invalidates cryptographic signatures. Bookmarks and document metadata are not retained. Interactive forms become static appearances; missing appearances can prevent export. Page annotations are copied, but their behavior and links may change. Review the saved file before using it.</p>
        {!!activeSources.length && <ul aria-label="Source document features">{activeSources.map(source => <li key={source.id}><strong>{source.name}:</strong> {source.report.forms} form fields, {source.report.annotations} annotations; bookmarks {source.report.outlines ? "detected" : "not detected"}; signatures {source.report.signatures ? "detected" : "not detected (not a signature verification)"}.</li>)}</ul>}
        <label><input type="checkbox" checked={acknowledged} disabled={!!busy} onChange={event => setAcknowledged(event.target.checked)} />I understand these changes and will review the output.</label>
      </div>
      <button type="button" className="primary" disabled={!!busy || !pages.length || !acknowledged || (mode === "selected" && !selectedPages.length)} onClick={() => void save()}>Export {mode === "ranges" || mode === "every" ? "PDF / ZIP" : "PDF"}</button>
      <p className="hint">One piece saves as PDF; multiple pieces save as ZIP. Saving requires Shard’s file permission. Encrypted PDFs and XFA forms are unsupported. The last 30 edits can be undone; clearing the session is permanent.</p>
    </section>
  </main>;
}
