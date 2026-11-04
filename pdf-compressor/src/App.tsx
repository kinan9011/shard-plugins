import { useEffect, useRef, useState, type DragEvent } from "react";
import { sdk } from "./sdk";
import { formatNumber, t, useT, type TKey } from "./lib/i18n";
import { compress, preview, runEngine } from "./pdf/client";
import type { Report } from "./pdf/engine";
import { DEFAULT_OPTIONS, MAX_FILE_BYTES, PRESETS, type Options, type Preset } from "./pdf/options";

type Source = { name: string; bytes: Uint8Array; report: Report };
type Result = { bytes: Uint8Array };
const size = (bytes: number) => `${formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 2 })} MiB`;
function errorText(error: unknown) {
  const key = error instanceof Error ? error.message : "error.pdf";
  return t(key.startsWith("error.") ? key as TKey : "error.failed");
}

export default function App() {
  const tr = useT();
  const [source, setSource] = useState<Source>();
  const [result, setResult] = useState<Result>();
  const [options, setOptions] = useState<Options>({ ...DEFAULT_OPTIONS });
  const [preset, setPreset] = useState<Preset>("gentle");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ key: TKey; vars?: Record<string, string | number> }>();
  const [error, setError] = useState<string>();
  const [previewError, setPreviewError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const dragDepth = useRef(0);
  const job = useRef<AbortController>();
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => () => job.current?.abort(), []);
  useEffect(() => {
    setPreviewError(false);
    if (!result || !canvas.current) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { setPreviewError(true); controller.abort(); }, 30_000);
    void preview(result.bytes, canvas.current, controller.signal).catch(() => { if (!controller.signal.aborted) setPreviewError(true); }).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [result]);

  function change(patch: Partial<Options>) {
    setOptions(current => ({ ...current, ...patch }));
    setPreset("custom"); setResult(undefined); setStatus(undefined);
  }
  function choosePreset(value: Preset) {
    setPreset(value); setResult(undefined); setStatus(undefined);
    if (value === "custom") setAdvanced(true);
    if (value !== "custom") setOptions(current => ({ ...current, ...PRESETS[value], color: value === "gentle" ? "color" : current.color }));
  }
  function readFile(file: File) {
    void loadFile(async () => {
      if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("error.fileSize");
      if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) throw new Error("error.pdf");
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    });
  }
  function dropFile(event: DragEvent) {
    event.preventDefault(); event.stopPropagation();
    dragDepth.current = 0; setDragging(false);
    if (job.current || saving) return;
    const files = event.dataTransfer.files;
    if (files.length !== 1) { setError(tr("error.oneFile")); return; }
    readFile(files[0]);
  }
  async function loadFile(getFile: () => Promise<{ name: string; bytes: Uint8Array } | null>) {
    if (job.current || saving) return;
    const controller = new AbortController(); job.current = controller;
    setBusy(true); setError(undefined); setStatus({ key: "status.opening" });
    try {
      const file = await getFile();
      controller.signal.throwIfAborted();
      if (!file) { setStatus(undefined); return; }
      if (!file.bytes.length || file.bytes.length > MAX_FILE_BYTES) throw new Error("error.fileSize");
      const report = await runEngine<Report>({ kind: "inspect", bytes: file.bytes }, controller.signal);
      setSource({ ...file, report }); setResult(undefined); setAcknowledged(false); setStatus(undefined);
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorText(failure));
      setStatus({ key: controller.signal.aborted ? "status.cancelled" : "status.failed" });
    } finally { job.current = undefined; setBusy(false); }
  }
  async function process() {
    if (!source || !acknowledged || job.current || saving) return;
    const controller = new AbortController(); job.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 180_000);
    setBusy(true); setError(undefined); setResult(undefined); setStatus({ key: "status.processing" });
    try {
      const bytes = await compress(source.bytes, options, controller.signal, (page, total) => setStatus({ key: "status.page", vars: { page, total } }));
      controller.signal.throwIfAborted();
      setResult({ bytes }); setStatus({ key: "status.ready" });
    } catch (failure) {
      if (timedOut) setError(tr("error.timeout"));
      else if (!controller.signal.aborted) setError(errorText(failure));
      setStatus({ key: controller.signal.aborted && !timedOut ? "status.cancelled" : "status.failed" });
    } finally { clearTimeout(timer); job.current = undefined; setBusy(false); }
  }
  async function save() {
    if (!result || !source || saving) return;
    setSaving(true); setError(undefined); setStatus({ key: "saving" });
    try {
      const saved = await sdk.files.save(`${source.name.replace(/\.pdf$/i, "")}-compressed.pdf`, result.bytes);
      setStatus({ key: saved ? "status.saved" : "status.saveCancelled" });
    } catch { setError(tr("error.save")); }
    finally { setSaving(false); }
  }
  const disabled = busy || saving;
  const raster = options.mode === "raster";
  const reduction = source && result ? (1 - result.bytes.length / source.bytes.length) * 100 : 0;

  return <main className={`compressor${dragging ? " is-dragging" : ""}`} onDragEnter={event => {
    event.preventDefault();
    if (Array.from(event.dataTransfer.types).includes("Files") && !disabled) { dragDepth.current++; setDragging(true); }
  }} onDragOver={event => {
    event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy";
  }} onDragLeave={event => {
    event.preventDefault();
    if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); }
  }} onDrop={dropFile}>
    <header className="toolbar">
      <div><h1>{tr("app.title")}</h1><p className="hint">{tr("app.local")}</p></div>
      {source && <button className="quiet" disabled={disabled} onClick={() => { setSource(undefined); setResult(undefined); setError(undefined); setStatus(undefined); setAcknowledged(false); setAdvanced(false); }}>{tr("clear")}</button>}
    </header>
        <input ref={input} hidden aria-label={tr("browse")} type="file" accept="application/pdf,.pdf" disabled={disabled} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (file) readFile(file);
        }} />

    <div className="workspace">
      <section className={`file-area${source ? " has-file" : ""}`} aria-label={tr("drop")} aria-busy={busy && !source}>
        <svg className="document-icon" width="48" height="56" viewBox="0 0 48 56" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M10 2h19l13 13v36a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Z"/><path d="M29 2v13h13M16 28h17M16 35h17M16 42h10"/></svg>
        <div className="file-info">{source ? <><strong className="filename"><bdi>{source.name}</bdi></strong><p className="hint"><bdi dir="ltr">{size(source.bytes.length)}</bdi> · {tr("pageCount", { count: source.report.pages })}</p></> : <><h2>{tr("drop")}</h2><p className="hint">{tr("limits")}</p></>}</div>
        <div className="file-actions">
          <button className={source ? "" : "primary"} disabled={disabled} onClick={() => {
            if (window.parent === window) input.current?.click();
            else void loadFile(() => sdk.files.open({ as: "bytes", accept: ["pdf"] }));
          }}>{tr("open")}</button>
          {window.parent !== window && <button className="quiet" disabled={disabled} onClick={() => input.current?.click()}>{tr("browse")}</button>}
        </div>
        {!source && busy && <button disabled={saving} onClick={() => job.current?.abort()}>{tr("cancel")}</button>}
      </section>

      {source && <section className="settings" aria-label={tr("settings")}>
        <fieldset disabled={disabled}>
          <label className="field">{tr("preset")}<select aria-label={tr("preset")} value={preset} onChange={event => choosePreset(event.target.value as Preset)}>
            {(["gentle", "balanced", "strong", "extreme", "custom"] as const).map(value => <option key={value} value={value}>{tr(`preset.${value}`)}</option>)}
          </select></label>
        </fieldset>
        <details className="advanced" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
          <summary>{tr("advanced")}</summary>
          <div className="advanced-content">
          <fieldset disabled={disabled}>
          <label className="field">{tr("method")}<select aria-label={tr("method")} value={options.mode} onChange={event => change({ mode: event.target.value as Options["mode"], color: "color" })}>
            <option value="optimize">{tr("method.optimize")}</option><option value="raster">{tr("method.raster")}</option>
          </select></label>
          <p className="hint">{tr(raster ? "method.rasterHint" : "method.optimizeHint")}</p>
          {raster && <>
            <label className="field">{tr("resolution")}<select aria-label={tr("resolution")} value={options.dpi} onChange={event => change({ dpi: Number(event.target.value) })}>
              {[36, 72, 96, 100, 150, 200, 300].map(value => <option key={value} dir="ltr" value={value}>{value} DPI</option>)}
            </select></label>
            <p className="hint">{tr("resolutionHint")}</p>
            <label className="field">{tr("color")}<select aria-label={tr("color")} value={options.color} onChange={event => change({ color: event.target.value as Options["color"] })}>
              <option value="color">{tr("color.color")}</option><option value="gray">{tr("color.gray")}</option><option value="bw">{tr("color.bw")}</option>
            </select></label>
            {options.color === "bw" ? <><label className="field">{tr("threshold", { value: options.threshold })}<input type="range" min="1" max="254" value={options.threshold} onChange={event => change({ threshold: Number(event.target.value) })} /></label><p className="hint">{tr("thresholdHint")}</p></> : <label className="field">{tr("quality", { value: options.quality })}<input type="range" min="10" max="100" value={options.quality} onChange={event => change({ quality: Number(event.target.value) })} /></label>}
          </>}
        </fieldset>
        <fieldset disabled={disabled}>
          <legend>{tr("cleanup")}</legend>
          <label className="check"><input type="checkbox" checked={raster || options.flattenForms} disabled={raster} onChange={event => change({ flattenForms: event.target.checked })} /><span>{tr("flattenForms")}</span></label>
          <label className="check"><input type="checkbox" checked={raster} onChange={event => change({ mode: event.target.checked ? "raster" : "optimize", color: "color" })} /><span>{tr("flattenAll")}</span></label>
          <label className="check"><input type="checkbox" checked={options.removeMetadata} onChange={event => change({ removeMetadata: event.target.checked })} /><span>{tr("metadata")}</span></label>
          <label className="check"><input type="checkbox" checked={raster || options.removeExtras} disabled={raster} onChange={event => change({ removeExtras: event.target.checked })} /><span>{tr("extras")}</span></label>
        </fieldset>
          </div>
        </details>
        <aside className="notice">
          <p>{tr(raster ? "warning.raster" : "warning.optimize")}</p>
          {source?.report.signatures && <strong>{tr("warning.signed")}</strong>}
          <label className="check"><input type="checkbox" disabled={disabled} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>{tr("acknowledge")}</span></label>
        </aside>
        <div className="actions">
          <button className="primary compress-action" disabled={!acknowledged || disabled} onClick={() => void process()}>{tr(busy ? "status.processing" : "compress")}</button>
          {busy && <button onClick={() => job.current?.abort()}>{tr("cancel")}</button>}
        </div>
      </section>}

      {result && source && <section className="output" aria-label={tr("result")}>
          <div className="result-heading"><h2>{tr("result")}</h2><button className="primary" disabled={disabled} onClick={() => void save()}>{tr(saving ? "saving" : "save")}</button></div>
          <dl className="metrics"><div><dt>{tr("original")}</dt><dd><bdi dir="ltr">{size(source.bytes.length)}</bdi></dd></div><div><dt>{tr("compressed")}</dt><dd><bdi dir="ltr">{size(result.bytes.length)}</bdi></dd></div><div><dt>{tr(reduction >= 0 ? "smaller" : "larger")}</dt><dd><bdi dir="ltr">{formatNumber(Math.abs(reduction), { maximumFractionDigits: 1 })}%</bdi></dd></div></dl>
          {reduction <= 0 && <p className="notice">{tr("noReduction")}</p>}
          <figure><canvas ref={canvas} aria-label={tr("preview")} role="img" /><figcaption>{tr(previewError ? "previewFailed" : "preview")}</figcaption></figure>
          <p className="hint">{tr("checkOutput")}</p>
      </section>}
    </div>
    <footer><div role="status" aria-live="polite">{status ? tr(status.key, status.vars) : ""}</div>{error && <p role="alert">{error}</p>}</footer>
    {dragging && <div className="drop-overlay" aria-hidden="true"><div>{tr("drop")}</div></div>}
  </main>;
}
