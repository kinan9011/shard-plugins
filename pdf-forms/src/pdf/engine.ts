import { PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFField, PDFName, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField, StandardFonts } from "pdf-lib";
import { zipSync } from "fflate";
import { FormError } from "./errors";

export const MAX_FILE = 50 * 1024 * 1024;
export const MAX_ROWS = 100;
export type Value = string | boolean | string[];
export type Values = Record<string, Value>;
export type FieldKind = "text" | "checkbox" | "dropdown" | "list" | "radio" | "signature" | "unsupported";
export interface Widget { page: number; rect: [number, number, number, number] }
export interface Field { name: string; kind: FieldKind; required: boolean; readOnly: boolean; value: Value; options: string[]; editable: boolean; multi: boolean; multiline: boolean; password: boolean; maxLength?: number; widgets: Widget[] }
export interface Inspection { fields: Field[]; pages: number; signed: boolean }
export interface Output { bytes: Uint8Array; extension: "pdf" | "zip"; count: number }
export type Request = { kind: "inspect"; bytes: Uint8Array } | { kind: "fill"; bytes: Uint8Array; values: Values; flatten?: boolean; preview?: boolean } | { kind: "batch"; bytes: Uint8Array; values: Values; rows: Values[]; flatten: boolean };

function bounded(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_FILE) throw new FormError("error.fileSize");
}

async function load(bytes: Uint8Array) {
  bounded(bytes);
  if (!new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-")) throw new FormError("error.pdf");
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }); }
  catch (error) { throw new FormError(/encrypt/i.test(String(error)) ? "error.encrypted" : "error.pdf"); }
  if (doc.isEncrypted) throw new FormError("error.encrypted");
  if (doc.getPageCount() > 500) throw new FormError("error.pages");
  // Check before getForm(): pdf-lib removes XFA when getForm() is called.
  const acro = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acro?.has(PDFName.of("XFA"))) throw new FormError("error.xfa");
  return doc;
}

function kind(field: PDFField): FieldKind {
  return field instanceof PDFTextField ? "text" : field instanceof PDFCheckBox ? "checkbox" : field instanceof PDFDropdown ? "dropdown" : field instanceof PDFOptionList ? "list" : field instanceof PDFRadioGroup ? "radio" : field instanceof PDFSignature ? "signature" : "unsupported";
}

export function describe(doc: PDFDocument): Inspection {
  const form = doc.getForm(), pages = doc.getPages();
  const raw = form.getFields();
  if (raw.length > 1000) throw new FormError("error.fields");
  const names = new Set<string>();
  const fields = raw.map(field => {
    const name = field.getName();
    if (names.has(name)) throw new FormError("error.duplicate", { name });
    names.add(name);
    const type = kind(field);
    const choice = field instanceof PDFDropdown || field instanceof PDFOptionList;
    const widgets: Widget[] = [];
    for (const widget of field.acroField.getWidgets()) {
      const page = pages.findIndex(page => {
        if (widget.P()?.toString() === page.ref.toString()) return true;
        const annots = page.node.Annots();
        return annots?.asArray().some(ref => doc.context.lookup(ref) === widget.dict);
      });
      if (page >= 0) { const r = widget.getRectangle(); widgets.push({ page: page + 1, rect: [r.x, r.y, r.x + r.width, r.y + r.height] }); }
    }
    return {
      name, kind: type, required: field.isRequired(), readOnly: field.isReadOnly(),
      value: field instanceof PDFTextField ? field.getText() ?? "" : field instanceof PDFCheckBox ? field.isChecked() : field instanceof PDFRadioGroup ? field.getSelected() ?? "" : choice ? field.isMultiselect() ? field.getSelected() : field.getSelected()[0] ?? "" : "",
      options: choice || field instanceof PDFRadioGroup ? field.getOptions() : [],
      editable: field instanceof PDFDropdown && field.isEditable(), multi: choice && field.isMultiselect(),
      multiline: field instanceof PDFTextField && field.isMultiline(), password: field instanceof PDFTextField && field.isPassword(),
      maxLength: field instanceof PDFTextField ? field.getMaxLength() : undefined, widgets,
    };
  });
  return { fields, pages: pages.length, signed: raw.some(field => field instanceof PDFSignature && field.acroField.dict.has(PDFName.of("V"))) };
}

export async function inspect(bytes: Uint8Array) { return describe(await load(bytes)); }
export const supported = (field: Field) => !["signature", "unsupported"].includes(field.kind);
export const empty = (value: Value) => Array.isArray(value) ? value.length === 0 : typeof value === "boolean" ? !value : value.trim() === "";
export const same = (a: Value, b: Value) => JSON.stringify(a) === JSON.stringify(b);

/** Validate every mapping before touching a document; missing keys leave the current values intact. */
export function validate(fields: Field[], values: Values, required = true) {
  const byName = new Map(fields.map(field => [field.name, field]));
  for (const [name, value] of Object.entries(values)) {
    const field = byName.get(name);
    if (!field) throw new FormError("error.unknown", { name });
    if (same(value, field.value)) continue;
    if (field.readOnly || !supported(field)) throw new FormError("error.readOnly", { name });
    if (field.kind === "checkbox") {
      if (typeof value !== "boolean") throw new FormError("error.boolean", { name });
    } else if (field.kind === "text") {
      if (typeof value !== "string") throw new FormError("error.text", { name });
      if (field.maxLength !== undefined && value.length > field.maxLength) throw new FormError("error.length", { name, max: field.maxLength });
    } else {
      if (typeof value === "boolean" || (field.multi ? !Array.isArray(value) || value.some(v => typeof v !== "string") : typeof value !== "string")) throw new FormError("error.choice", { name });
      const selected = Array.isArray(value) ? value : value === "" ? [] : [value];
      if (!field.editable && selected.some(v => !field.options.includes(v))) throw new FormError("error.choice", { name });
    }
  }
  if (required) for (const field of fields) {
    if (supported(field) && !field.readOnly && field.required && empty(Object.hasOwn(values, field.name) ? values[field.name] : field.value)) throw new FormError("error.required", { name: field.name });
  }
}

export async function fill(bytes: Uint8Array, values: Values, flatten = false, preview = false): Promise<Uint8Array> {
  const doc = await load(bytes), info = describe(doc), form = doc.getForm();
  validate(info.fields, values, !preview);
  if (flatten && info.fields.some(field => !supported(field))) throw new FormError("error.flattenUnsupported");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const field of info.fields) {
    if (!Object.hasOwn(values, field.name) || same(values[field.name], field.value)) continue;
    const raw = form.getField(field.name), value = values[field.name];
    if (raw instanceof PDFTextField) raw.setText(value as string);
    else if (raw instanceof PDFCheckBox) value ? raw.check() : raw.uncheck();
    else if (raw instanceof PDFRadioGroup) value ? raw.select(value as string) : raw.clear();
    else if (raw instanceof PDFDropdown || raw instanceof PDFOptionList) {
      if (value === "" || Array.isArray(value) && !value.length) raw.clear(); else raw.select(value as string | string[]);
    }
    // Update only changed fields: preserve existing fonts and appearances of untouched fields.
    try {
      if (raw instanceof PDFCheckBox || raw instanceof PDFRadioGroup) raw.updateAppearances();
      else if (raw instanceof PDFTextField || raw instanceof PDFDropdown || raw instanceof PDFOptionList) raw.updateAppearances(font);
    }
    catch { throw new FormError("error.appearance", { name: field.name }); }
  }
  if (flatten) {
    const widgets = new Set(form.getFields().flatMap(field => field.acroField.getWidgets().map(widget => widget.dict)));
    for (const page of doc.getPages()) for (const ref of page.node.Annots()?.asArray() ?? []) {
      const annotation = doc.context.lookup(ref);
      if (annotation instanceof PDFDict && annotation.get(PDFName.of("Subtype"))?.toString() === "/Widget" && !widgets.has(annotation)) throw new FormError("error.flattenUnsupported");
    }
    try { form.flatten({ updateFieldAppearances: false }); }
    catch { throw new FormError("error.flatten"); }
    for (const page of doc.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      for (let i = annots.size() - 1; i >= 0; i--) {
        const annotation = doc.context.lookup(annots.get(i));
        if (!annotation || annotation instanceof PDFDict && annotation.get(PDFName.of("Subtype"))?.toString() === "/Widget") annots.remove(i);
      }
    }
    doc.catalog.delete(PDFName.of("AcroForm"));
  }
  // Disable automatic regeneration, which otherwise overwrites untouched appearances/fonts.
  const output = await doc.save({ updateFieldAppearances: false });
  bounded(output);
  return output;
}

export async function batch(bytes: Uint8Array, values: Values, rows: Values[], flatten: boolean): Promise<Output> {
  if (!rows.length || rows.length > MAX_ROWS) throw new FormError("error.rows");
  const { fields } = await inspect(bytes);
  rows.forEach((row, index) => {
    try { validate(fields, { ...values, ...row }); }
    catch (error) { if (error instanceof FormError) throw new FormError(error.key, { ...error.vars, row: index + 1 }); throw error; }
  });
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    try { files[`form-${String(i + 1).padStart(3, "0")}.pdf`] = await fill(bytes, { ...values, ...rows[i] }, flatten); }
    catch (error) { if (error instanceof FormError) throw new FormError(error.key, { ...error.vars, row: i + 1 }); throw error; }
    total += files[`form-${String(i + 1).padStart(3, "0")}.pdf`].length;
    if (total > MAX_FILE) throw new FormError("error.batchSize");
  }
  const output = zipSync(files, { mtime: new Date(2000, 0, 1) });
  bounded(output);
  return { bytes: output, extension: "zip", count: rows.length };
}

export async function execute(request: Request) {
  if (request.kind === "inspect") return inspect(request.bytes);
  if (request.kind === "batch") return batch(request.bytes, request.values, request.rows, request.flatten);
  return fill(request.bytes, request.values, request.flatten, request.preview);
}
