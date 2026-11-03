import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Source } from "./pdf/engine";

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
  return <Dialog title={title} onCancel={onCancel}>
    <p>{body}</p>
    <div className="dialog-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="primary" autoFocus onClick={onConfirm}>{label}</button></div>
  </Dialog>;
}

export function WarningDialog({ sources, onCancel, onConfirm }: { sources: Source[]; onCancel: () => void; onConfirm: () => void }) {
  return <Dialog title="Before you save" onCancel={onCancel}>
    <p>Editing rebuilds the PDF and invalidates cryptographic signatures. Bookmarks and document metadata are not retained. Interactive forms become static appearances; missing appearances can prevent export. Page annotations are copied, but their behavior and links may change. Review the saved file before using it. Your originals are never changed.</p>
    {!!sources.length && <details><summary>Source document features</summary><ul aria-label="Source document features">{sources.map(source => <li key={source.id}><strong>{source.name}:</strong> {source.report.forms} form fields, {source.report.annotations} annotations; bookmarks {source.report.outlines ? "detected" : "not detected"}; signatures {source.report.signatures ? "detected" : "not detected (not a signature verification)"}.</li>)}</ul></details>}
    <div className="dialog-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="primary" autoFocus onClick={onConfirm}>I understand, save</button></div>
  </Dialog>;
}

export function ExportDialog({ initial, selectedCount, total, onCancel, onExport }: { initial: ExportOptions; selectedCount: number; total: number; onCancel: () => void; onExport: (options: ExportOptions) => void }) {
  const [options, setOptions] = useState<ExportOptions>(selectedCount ? initial : { ...initial, scope: "all" });
  const set = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => setOptions(previous => ({ ...previous, [key]: value }));
  const count = options.scope === "selected" ? selectedCount : total;
  return <Dialog title="Export pages" onCancel={onCancel}>
    {/* Not a <form>: the plugin frame is sandboxed without allow-forms, so submit events never fire. */}
    <div className="dialog-form" onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); onExport(options); } }}>
      <label>Pages<select value={options.scope} onChange={event => set("scope", event.target.value as ExportOptions["scope"])}>
        <option value="all">All pages ({total})</option><option value="selected" disabled={!selectedCount}>Selected pages ({selectedCount})</option>
      </select></label>
      <label>Output<select value={options.mode} onChange={event => set("mode", event.target.value as ExportOptions["mode"])}>
        <option value="one">One PDF</option><option value="each">One PDF per page (ZIP)</option>
        <option value="every">Split every N pages (ZIP)</option><option value="ranges">Custom ranges (ZIP)</option>
      </select></label>
      {options.mode === "every" && <label>Pages per file<input type="number" min="1" max="500" step="1" value={options.every} onChange={event => set("every", event.target.value)} /></label>}
      {options.mode === "ranges" && <label>Ranges<input value={options.ranges} placeholder="1-3;4-6;7,9" aria-describedby="range-help" onChange={event => set("ranges", event.target.value)} />
        <small id="range-help">Numbers count within the {count} exported page(s). Semicolons start a new file; commas join pages.</small></label>}
      <div className="dialog-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="primary" onClick={() => onExport(options)}>Export</button></div>
    </div>
  </Dialog>;
}

const shortcuts: [string, string][] = [
  ["Ctrl+O / Ctrl+I", "Open / import after the selected page"], ["Ctrl+S", "Save all pages as one PDF"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"], ["Ctrl+X / C / V", "Cut / copy / paste after selection"],
  ["Ctrl+D", "Duplicate selected pages"], ["Delete", "Delete selected pages"],
  ["Ctrl+← / Ctrl+→", "Rotate left / right"], ["Alt+← / Alt+→", "Move selected pages earlier / later"],
  ["Ctrl+A / Ctrl+Shift+A", "Select all / none"], ["+ / − / 0", "Zoom in / out / reset"],
  ["Arrows, Home, End", "Move focus and select; Shift extends"], ["Space", "Toggle the focused page"],
  ["Insert", "Insert a blank page after the selection"], ["Shift+F10", "Open the page menu"], ["?", "Show this list"],
];

export function ShortcutsDialog({ onCancel }: { onCancel: () => void }) {
  return <Dialog title="Shortcuts and gestures" onCancel={onCancel}>
    <dl className="shortcuts">{shortcuts.map(([keys, what]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{what}</dd></div>)}</dl>
    <p className="hint">Click selects a page; Ctrl/Cmd+click toggles; Shift+click selects a range. Drag empty space to select with a box. Drag a page (or the selected group) to move it; hold Ctrl while dropping to copy. Touch: tap toggles, press and hold then drag to move. Right-click for more actions.</p>
    <div className="dialog-actions"><button type="button" className="primary" autoFocus onClick={onCancel}>Close</button></div>
  </Dialog>;
}

export type Field = { key: string; label: string; kind?: "number" | "text" | "select"; options?: [string, string][]; min?: number; max?: number; step?: number; hint?: string };

/** Small settings dialog. `onSubmit` returns an error message to keep the dialog open, or nothing to accept. */
export function FieldsDialog({ title, fields, initial, submit, intro, onCancel, onSubmit }: { title: string; fields: Field[]; initial: Record<string, string>; submit: string; intro?: string; onCancel: () => void; onSubmit: (values: Record<string, string>) => string | void }) {
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
          : <input type={field.kind === "text" ? "text" : "number"} min={field.min} max={field.max} step={field.step} value={values[field.key]} maxLength={field.kind === "text" ? 500 : undefined}
              onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} />}
        {field.hint && <small>{field.hint}</small>}
      </label>)}
      {message && <p className="error-text" role="alert">{message}</p>}
      <div className="dialog-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="primary" onClick={go}>{submit}</button></div>
    </div>
  </Dialog>;
}
