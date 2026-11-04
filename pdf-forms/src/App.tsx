import { useEffect, useMemo, useRef, useState } from "react";
import { sdk } from "./sdk";
import { useToolActive } from "./hooks/useToolActive";
import { useT, type TKey } from "./lib/i18n";
import { FormError } from "./pdf/errors";
import { empty, MAX_FILE, same, supported, validate, type Field, type Inspection, type Value, type Values, type Output } from "./pdf/engine";
import { parseMapping } from "./pdf/mapping";
import { runEngine } from "./pdf/client";
import FieldEditor from "./FieldEditor";
import Preview from "./Preview";
import Confirm from "./Confirm";

type Source = Inspection & { name: string; bytes: Uint8Array };
type Dialog = { title: string; body: string; action: string; run: () => void };
export default function App() {
  const t = useT(), active = useToolActive(), root = useRef<HTMLElement>(null);
  const [source, setSource] = useState<Source | null>(null), [values, setValues] = useState<Values>({}), [savedValues, setSavedValues] = useState<Values>({});
  const [page, setPage] = useState(1), [selected, setSelected] = useState(""), [search, setSearch] = useState(""), [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState<"working" | "saving" | null>(null), operation = useRef<AbortController | null>(null);
  const [error, setError] = useState<Error | null>(null), [notice, setNotice] = useState<{ key: TKey; vars?: Record<string, string | number> } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null), [flatten, setFlatten] = useState(false), [mappingOpen, setMappingOpen] = useState(false), [helpOpen, setHelpOpen] = useState(false);
  const [mapping, setMapping] = useState(""), [format, setFormat] = useState<"json" | "csv">("json"), [rows, setRows] = useState<Values[]>([]), [row, setRow] = useState(0);
  const [preview, setPreview] = useState<Uint8Array | null>(null), [previewState, setPreviewState] = useState<"current" | "loading" | "stale">("current");
  const fileInput = useRef<HTMLInputElement>(null), mappingInput = useRef<HTMLInputElement>(null);
  const effective = useMemo(() => rows.length ? { ...values, ...rows[row] } : values, [values, rows, row]);
  const dirty = source && source.fields.some(field => !same(values[field.name], savedValues[field.name]));
  const requiredLeft = source?.fields.filter(field => field.required && !field.readOnly && supported(field) && empty(effective[field.name])).length ?? 0;
  const canFlatten = source?.fields.every(supported) ?? false;
  const visible = source?.fields.filter(field => field.name.toLowerCase().includes(search.toLowerCase())) ?? [];
  const message = (error: Error): string => {
    if (!(error instanceof FormError)) return t("error.processing");
    const body = t(error.key as TKey, error.vars);
    return error.vars.row ? t("mapping.rowError", { n: error.vars.row, message: body }) : body;
  };

  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (!source || !active) return;
    const controller = new AbortController();
    setPreviewState("loading");
    const timer = setTimeout(() => {
      void runEngine<Uint8Array>({ kind: "fill", bytes: source.bytes, values: effective, preview: true }, controller.signal).then(bytes => {
        if (!controller.signal.aborted) { setPreview(bytes); setPreviewState("current"); }
      }).catch(error => {
        if (controller.signal.aborted) return;
        setPreviewState("stale"); setError(error instanceof Error ? error : new FormError("error.processing"));
      });
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [source, effective, active]);

  async function perform(kind: "working" | "saving", action: (signal: AbortSignal) => Promise<void>, fallback: string) {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(kind); setError(null); setNotice(null);
    try { await action(controller.signal); }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof FormError ? error : new FormError(fallback)); }
    finally { if (operation.current === controller) { operation.current = null; setBusy(null); } }
  }

  function guard(run: () => void, reset = false) {
    if (dirty || rows.length) setDialog({ title: t(reset ? "reset" : "replace"), body: t(reset ? "reset.body" : "replace.body"), action: t(reset ? "reset" : "discard"), run });
    else run();
  }
  async function readPdf(name: string, bytes: Uint8Array, signal: AbortSignal) {
    const info = await runEngine<Inspection>({ kind: "inspect", bytes }, signal);
    if (signal.aborted) return;
    const initial = Object.fromEntries(info.fields.map(field => [field.name, field.value]));
    setSource({ ...info, name, bytes }); setValues(initial); setSavedValues(initial); setPreview(bytes); setPage(1); setSelected(""); setSearch(""); setFlatten(false); setRows([]); setRow(0); setMapping(""); setMappingOpen(false); setPreviewState("current");
  }
  function choosePdf() {
    guard(() => {
      if (window.parent === window) { fileInput.current?.click(); return; }
      void perform("working", async signal => {
        const file = await sdk.files.open({ as: "bytes", accept: ["pdf"] });
        if (file && !signal.aborted) await readPdf(file.name, file.bytes, signal);
      }, "error.open");
    });
  }
  function reset() {
    if (!source) return;
    guard(() => { setValues(Object.fromEntries(source.fields.map(field => [field.name, field.value]))); setRows([]); setRow(0); setError(null); setNotice(null); }, true);
  }
  function selectField(field: Field, focus = false) {
    setSelected(field.name); if (!focus && field.widgets[0]) setPage(field.widgets[0].page);
    if (focus) {
      setSearch("");
      requestAnimationFrame(() => {
        const element = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-field]") ?? []).find(el => el.dataset.field === field.name);
        element?.scrollIntoView({ block: "nearest", behavior: "instant" }); element?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
      });
    }
  }
  function update(name: string, value: Value) { setValues(current => ({ ...current, [name]: value })); setNotice(null); setError(null); }

  function requestSave(batch: boolean) {
    if (!source || busy || !source.fields.some(supported)) return;
    try {
      if (!batch) validate(source.fields, effective);
      if (flatten && !canFlatten) throw new FormError("error.flattenUnsupported");
    } catch (error) { setError(error as Error); return; }
    const run = () => void perform("working", async signal => {
      const output = batch ? await runEngine<Output>({ kind: "batch", bytes: source.bytes, values, rows, flatten }, signal)
        : { bytes: await runEngine<Uint8Array>({ kind: "fill", bytes: source.bytes, values: effective, flatten }, signal), extension: "pdf" };
      if (signal.aborted) return;
      const name = `${source.name.replace(/\.pdf$/i, "") || "form"}-${batch ? "batch" : flatten ? "flattened" : "filled"}.${output.extension}`;
      setBusy("saving");
      const saved = await sdk.files.save(name, output.bytes);
      if (saved) { if (!batch && !rows.length) setSavedValues(values); setNotice({ key: "status.saved", vars: { name } }); }
      else setNotice({ key: "status.cancelled" });
    }, "error.save");
    if (flatten || source.signed) setDialog({ title: t(flatten ? "warning.title" : "warning.signedTitle"), body: [flatten ? t("warning.body") : "", source.signed ? t("warning.signature") : ""].filter(Boolean).join(" "), action: t("warning.confirm"), run });
    else run();
  }

  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target !== document.body && !root.current?.contains(target)) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault(); if (!event.repeat && !dialog) requestSave(false);
      }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  });

  function applyMapping(text = mapping, type = format) {
    if (!source) return;
    try {
      const parsed = parseMapping(text, type, source.fields);
      if (parsed.length === 1) { setValues(current => ({ ...current, ...parsed[0] })); setRows([]); }
      else { setRows(parsed); setRow(0); }
      setError(null); setNotice({ key: "mapping.applied" }); setMappingOpen(false);
    } catch (error) { setError(error as Error); }
  }
  function loadMapping(name: string, text: string) {
    if (!/\.(json|csv)$/i.test(name)) throw new FormError("error.mappingFile");
    if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new FormError("error.mappingSize");
    setMapping(text); setFormat(/\.csv$/i.test(name) ? "csv" : "json");
  }
  function chooseMapping() {
    if (window.parent === window) { mappingInput.current?.click(); return; }
    void perform("working", async signal => {
      const file = await sdk.files.open({ as: "text", accept: ["json", "csv"] });
      if (file && !signal.aborted) { if (file.size > 2 * 1024 * 1024) throw new FormError("error.mappingSize"); loadMapping(file.name, file.text); }
    }, "error.open");
  }
  function saveTemplate() {
    if (!source) return;
    void perform("saving", async () => {
      const template = Object.fromEntries(source.fields.filter(field => supported(field) && !field.readOnly).map(field => [field.name, effective[field.name]]));
      const name = "form-fields.json", saved = await sdk.files.save(name, JSON.stringify(template, null, 2));
      setNotice({ key: saved ? "status.saved" : "status.cancelled", vars: { name } });
    }, "error.save");
  }
  return <main ref={root} className="forms-app" aria-busy={!!busy} onDragOver={e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onDrop={e => {
    if (!e.dataTransfer.files.length) return; e.preventDefault();
    if (busy || dialog) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length !== 1) { setError(new FormError("error.oneFile")); return; }
    const file = files[0]; guard(() => void perform("working", async signal => {
      if (file.size > MAX_FILE) throw new FormError("error.fileSize"); await readPdf(file.name, new Uint8Array(await file.arrayBuffer()), signal);
    }, "error.open"));
  }}>
    <input type="file" hidden ref={fileInput} accept="application/pdf,.pdf" aria-label={t("open")} onChange={e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
      void perform("working", async signal => { if (file.size > MAX_FILE) throw new FormError("error.fileSize"); await readPdf(file.name, new Uint8Array(await file.arrayBuffer()), signal); }, "error.open");
    }} />
    <input type="file" hidden ref={mappingInput} accept=".json,.csv" aria-label={t("mapping.import")} onChange={e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
      void perform("working", async () => { if (file.size > 2 * 1024 * 1024) throw new FormError("error.mappingSize"); loadMapping(file.name, await file.text()); }, "error.open");
    }} />
    <header className="editor-toolbar"><div className="document-title"><h1>{t("app.title")}</h1>{source && <bdi title={source.name}>{source.name}</bdi>}</div><div className="toolbar-actions">
      <button type="button" disabled={!!busy} onClick={choosePdf}>{t(source ? "replace" : "open")}</button>
      {source && <button type="button" className="primary" disabled={!!busy || !source.fields.some(supported)} onClick={() => requestSave(false)}>{t("save")}</button>}
    </div></header>
    {error && <div className="error-banner" role="alert"><p>{message(error)}</p><button type="button" aria-label={t("close")} onClick={() => setError(null)}>×</button></div>}
    {!source ? <section className="empty-state"><svg width="56" height="56" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M13 5h15l9 9v29H11V5h2ZM28 5v10h9M17 23h14M17 29h8M17 35h14" /><path d="m27 28 2 2 4-5" /></svg><h2>{t("empty.title")}</h2><p>{t("empty.body")}</p><button type="button" className="primary" disabled={!!busy} onClick={choosePdf}>{t("open")}</button><p className="muted">{t("empty.drop")}</p><small>{t("empty.limit")}</small></section>
    : <div className="workspace"><section className="fields-panel" aria-label={t("fields")}>
      <div className="panel-header"><h2>{t("fields")}</h2><span className="count">{source.fields.length}</span><button type="button" className="text-button push-end" disabled={!!busy} onClick={reset}>{t("reset")}</button></div>
      <div className="field-tools"><input type="search" aria-label={t("search")} placeholder={t("search")} value={search} onChange={e => setSearch(e.target.value)} /><button type="button" disabled={!!busy} aria-expanded={mappingOpen} onClick={() => setMappingOpen(open => !open)}>{t("mapping")}</button></div>
      {mappingOpen && <section className="mapping-panel" aria-labelledby="mapping-title"><h3 id="mapping-title">{t("mapping.title")}</h3><p>{t("mapping.body")}</p><div className="mapping-actions"><button type="button" disabled={!!busy} onClick={chooseMapping}>{t("mapping.import")}</button><button type="button" disabled={!!busy} onClick={saveTemplate}>{t("mapping.template")}</button></div><label className="format-label">{t("mapping.format")}<select aria-label={t("mapping.format")} value={format} disabled={!!busy} onChange={e => setFormat(e.target.value as "json" | "csv")}><option value="json">JSON</option><option value="csv">CSV</option></select></label><label className="sr-only" htmlFor="mapping-input">{t("mapping.input")}</label><textarea id="mapping-input" dir="ltr" spellCheck={false} rows={6} value={mapping} maxLength={2 * 1024 * 1024} disabled={!!busy} onChange={e => setMapping(e.target.value)} /><p className="hint">{t("mapping.help")}</p><button type="button" className="primary" disabled={!!busy || !mapping.trim()} onClick={() => applyMapping()}>{t("mapping.apply")}</button></section>}
      {!!rows.length && <div className="batch-panel"><strong>{t("mapping.ready", { n: rows.length })}</strong><label>{t("mapping.row")}<select aria-label={t("mapping.row")} value={row} disabled={!!busy} onChange={e => { setRow(Number(e.target.value)); setError(null); }}>{rows.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label><button type="button" className="text-button" disabled={!!busy} onClick={() => { setRows([]); setRow(0); setError(null); }}>{t("mapping.clear")}</button></div>}
      <div className="field-list">{source.fields.length ? visible.length ? visible.map(field => <FieldEditor key={field.name} field={field} value={effective[field.name]} selected={selected === field.name} disabled={!!busy || !!rows.length} onChange={value => update(field.name, value)} onFocus={() => selectField(field)} />) : <p className="panel-empty">{t("noResults")}</p> : <div className="panel-empty"><h3>{t("noFields")}</h3><p>{t("noFields.body")}</p></div>}</div>
      <div className="save-options"><label className="check-label"><input type="checkbox" checked={flatten} disabled={!!busy || !canFlatten} onChange={e => setFlatten(e.target.checked)} />{t("flatten")}</label><p className="hint">{t(canFlatten ? "flatten.help" : "error.flattenUnsupported")}</p>{source.signed && <p className="hint">{t("signature.note")}</p>}{!!rows.length && <button type="button" className="primary batch-save" disabled={!!busy} onClick={() => requestSave(true)}>{t("mapping.zip", { n: rows.length })}</button>}</div>
    </section><section className="preview-panel" aria-label={t("preview")}><div className="panel-header"><h2>{t("preview")}</h2><span className="push-end preview-status" role="status">{t(`preview.${previewState === "current" ? "current" : previewState === "loading" ? "loading" : "stale"}`)}</span></div><div className="preview-toolbar"><button type="button" aria-label={t("previous")} disabled={page <= 1} onClick={() => setPage(n => n - 1)}>‹</button><span className="page-count" dir="auto">{t("page", { n: page, total: source.pages })}</span><button type="button" aria-label={t("next")} disabled={page >= source.pages} onClick={() => setPage(n => n + 1)}>›</button><label className="push-end zoom-control">{t("zoom")}<select value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value={1}>100%</option><option value={1.25}>125%</option><option value={1.5}>150%</option></select></label></div>{preview && <Preview bytes={preview} page={page} fields={source.fields} selected={selected} onSelect={field => selectField(field, true)} zoom={zoom} />}</section></div>}
    <footer className="status-bar"><span>{source ? t("status.fields", { n: source.fields.length, required: requiredLeft }) : t("status.empty")}</span><span className="status-message" role="status">{busy ? t(busy) : notice ? t(notice.key, notice.vars) : dirty ? t("status.unsaved") : source ? t("status.original") : t("app.local")}</span>{busy === "working" && <button type="button" onClick={() => operation.current?.abort()}>{t("cancel")}</button>}<button type="button" className="text-button" aria-expanded={helpOpen} onClick={() => setHelpOpen(open => !open)}>{t("help")}</button></footer>
    {helpOpen && <aside className="help-panel"><p>{t("help.body")}</p><button type="button" onClick={() => setHelpOpen(false)}>{t("close")}</button></aside>}
    {dialog && <Confirm title={dialog.title} action={dialog.action} onCancel={() => setDialog(null)} onConfirm={() => { const run = dialog.run; setDialog(null); run(); }}><p>{dialog.body}</p></Confirm>}
  </main>;
}
