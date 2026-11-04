import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Source } from "./pdf/engine";
import { autoDir, useT, type TKey } from "@/lib/i18n";

export type ExportOptions = { scope: "all" | "selected"; mode: "one" | "each" | "every" | "ranges"; every: string; ranges: string };
export const defaultExport: ExportOptions = { scope: "all", mode: "one", every: "2", ranges: "" };

/** Native modal <dialog>: focus trap, inert background and Escape come from the browser. Mounted only while open. */
export function Dialog({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={id} onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id={id}>{title}</h2>{children}
  </dialog>;
}

export function ConfirmDialog({ title, body, label, onCancel, onConfirm }: { title: string; body: string; label: string; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  return <Dialog title={title} onCancel={onCancel}>
    <p>{body}</p>
    <div className="dialog-actions"><button type="button" onClick={onCancel}>{t("common.cancel")}</button><button type="button" className="primary" autoFocus onClick={onConfirm}>{label}</button></div>
  </Dialog>;
}

export function WarningDialog({ sources, onCancel, onConfirm }: { sources: Source[]; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  return <Dialog title={t("warning.title")} onCancel={onCancel}>
    <p>{t("warning.body")}</p>
    {!!sources.length && <details><summary>{t("warning.features")}</summary><ul aria-label={t("warning.features")}>{sources.map(source => <li key={source.id}><strong dir="auto">{source.name}:</strong> {t("warning.item", { forms: source.report.forms, annotations: source.report.annotations, bookmarks: t(source.report.outlines ? "warning.bookmarksFound" : "warning.bookmarksNone"), signatures: t(source.report.signatures ? "warning.signaturesFound" : "warning.signaturesNone") })}</li>)}</ul></details>}
    <div className="dialog-actions"><button type="button" onClick={onCancel}>{t("common.cancel")}</button><button type="button" className="primary" autoFocus onClick={onConfirm}>{t("warning.confirm")}</button></div>
  </Dialog>;
}

export function ExportDialog({ initial, selectedCount, total, onCancel, onExport }: { initial: ExportOptions; selectedCount: number; total: number; onCancel: () => void; onExport: (options: ExportOptions) => void }) {
  const [options, setOptions] = useState<ExportOptions>(selectedCount ? initial : { ...initial, scope: "all" });
  const t = useT();
  const set = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => setOptions(previous => ({ ...previous, [key]: value }));
  const count = options.scope === "selected" ? selectedCount : total;
  return <Dialog title={t("dlg.export.title")} onCancel={onCancel}>
    {/* Not a <form>: the plugin frame is sandboxed without allow-forms, so submit events never fire. */}
    <div className="dialog-form" onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); onExport(options); } }}>
      <label>{t("field.pages")}<select value={options.scope} onChange={event => set("scope", event.target.value as ExportOptions["scope"])}>
        <option value="all">{t("option.scopeAll", { count: total })}</option><option value="selected" disabled={!selectedCount}>{t("option.scopeSelected", { count: selectedCount })}</option>
      </select></label>
      <label>{t("field.output")}<select value={options.mode} onChange={event => set("mode", event.target.value as ExportOptions["mode"])}>
        <option value="one">{t("option.modeOne")}</option><option value="each">{t("option.modeEach")}</option>
        <option value="every">{t("option.modeEvery")}</option><option value="ranges">{t("option.modeRanges")}</option>
      </select></label>
      {options.mode === "every" && <label>{t("field.perFile")}<input type="number" min="1" max="500" step="1" value={options.every} onChange={event => set("every", event.target.value)} /></label>}
      {options.mode === "ranges" && <label>{t("field.ranges")}<input dir="ltr" value={options.ranges} placeholder="1-3;4-6;7,9" aria-describedby="range-help" onChange={event => set("ranges", event.target.value)} />
        <small id="range-help">{t("field.rangesHint", { count })}</small></label>}
      <div className="dialog-actions"><button type="button" onClick={onCancel}>{t("common.cancel")}</button><button type="button" className="primary" onClick={() => onExport(options)}>{t("button.export")}</button></div>
    </div>
  </Dialog>;
}

// Key names stay as they are; only the description is translated.
const shortcuts: [string, TKey][] = [
  ["Ctrl+O / Ctrl+I", "shortcut.openImport"], ["Ctrl+S", "shortcut.save"],
  ["Ctrl+Z / Ctrl+Y", "shortcut.undoRedo"], ["Ctrl+X / C / V", "shortcut.clipboard"],
  ["Ctrl+D", "shortcut.duplicate"], ["Delete", "shortcut.delete"],
  ["Ctrl+← / Ctrl+→", "shortcut.rotate"], ["Alt+← / Alt+→", "shortcut.move"],
  ["Ctrl+A / Ctrl+Shift+A", "shortcut.select"], ["+ / − / 0", "shortcut.zoom"],
  ["Arrows, Home, End", "shortcut.arrows"], ["Space", "shortcut.space"],
  ["Insert", "shortcut.insert"], ["Shift+F10", "shortcut.menu"], ["?", "shortcut.help"],
];

export function ShortcutsDialog({ onCancel }: { onCancel: () => void }) {
  const t = useT();
  return <Dialog title={t("shortcuts.title")} onCancel={onCancel}>
    <dl className="shortcuts">{shortcuts.map(([keys, what]) => <div key={keys}><dt><kbd dir="ltr">{keys}</kbd></dt><dd>{t(what)}</dd></div>)}</dl>
    <p className="hint">{t("shortcuts.hint")}</p>
    <div className="dialog-actions"><button type="button" className="primary" autoFocus onClick={onCancel}>{t("common.close")}</button></div>
  </Dialog>;
}

export type Field = { key: string; label: string; kind?: "number" | "text" | "select"; options?: [string, string][]; min?: number; max?: number; step?: number; hint?: string };

/** Small settings dialog. `onSubmit` returns an error message to keep the dialog open, or nothing to accept. */
export function FieldsDialog({ title, fields, initial, submit, intro, onCancel, onSubmit }: { title: string; fields: Field[]; initial: Record<string, string>; submit: string; intro?: string; onCancel: () => void; onSubmit: (values: Record<string, string>) => string | void }) {
  const t = useT();
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState("");
  const go = () => setMessage(onSubmit(values) ?? "");
  return <Dialog title={title} onCancel={onCancel}>
    {intro && <p className="hint">{intro}</p>}
    {/* Not a <form>: the plugin frame is sandboxed without allow-forms, so submit events never fire. */}
    <div className="dialog-form" onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); go(); } }}>
      {fields.map(field => <label key={field.key}>{field.label}
        {field.kind === "select"
          ? <select value={values[field.key]} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))}>{field.options!.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
          : <input type={field.kind === "text" ? "text" : "number"} min={field.min} max={field.max} step={field.step} value={values[field.key]} maxLength={field.kind === "text" ? 500 : undefined} dir={field.kind === "text" ? autoDir(values[field.key]) : undefined}
              onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} />}
        {field.hint && <small>{field.hint}</small>}
      </label>)}
      {message && <p className="error-text" role="alert">{message}</p>}
      <div className="dialog-actions"><button type="button" onClick={onCancel}>{t("common.cancel")}</button><button type="button" className="primary" onClick={go}>{submit}</button></div>
    </div>
  </Dialog>;
}
