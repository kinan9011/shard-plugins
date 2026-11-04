// @vitest-environment node
import { describe as suite, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { unzipSync } from "fflate";
import { batch, empty, fill, inspect, validate } from "../src/pdf/engine";
import { csvRows, parseMapping } from "../src/pdf/mapping";

async function fixture() {
  const doc = await PDFDocument.create(), page = doc.addPage([500, 650]), second = doc.addPage([400, 550]), form = doc.getForm();
  const name = form.createTextField("person.name"); name.enableRequired(); name.setMaxLength(30); name.addToPage(page, { x: 40, y: 500, width: 250, height: 24 });
  const notes = form.createTextField("notes"); notes.enableMultiline(); notes.addToPage(second, { x: 40, y: 400, width: 250, height: 60 });
  const check = form.createCheckBox("consent"); check.enableRequired(); check.addToPage(page, { x: 40, y: 450, width: 18, height: 18 });
  const drop = form.createDropdown("country"); drop.setOptions(["Germany", "France"]); drop.select("Germany"); drop.addToPage(page, { x: 40, y: 400, width: 250, height: 24 });
  const list = form.createOptionList("interests"); list.setOptions(["Music", "Science", "Art"]); list.enableMultiselect(); list.addToPage(second, { x: 40, y: 250, width: 250, height: 70 });
  const radio = form.createRadioGroup("plan"); radio.addOptionToPage("Basic", page, { x: 40, y: 350, width: 18, height: 18 }); radio.addOptionToPage("Plus", page, { x: 100, y: 350, width: 18, height: 18 });
  const lock = form.createTextField("reference"); lock.setText("LOCKED"); lock.enableReadOnly(); lock.addToPage(page, { x: 40, y: 300, width: 200, height: 24 });
  form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica));
  return doc.save();
}
const valid = { "person.name": "Ada Lovelace", consent: true, country: "France", interests: ["Science", "Art"], plan: "Plus", notes: "Line one\nLine two" };

suite("PDF form engine", () => {
  it("lists field names, types, constraints and all widget positions", async () => {
    const info = await inspect(await fixture());
    expect(info.pages).toBe(2); expect(info.signed).toBe(false); expect(info.fields).toHaveLength(7);
    expect(info.fields.find(f => f.name === "person.name")).toMatchObject({ kind: "text", required: true, maxLength: 30, value: "", widgets: [{ page: 1, rect: expect.any(Array) }] });
    expect(info.fields.find(f => f.name === "plan")?.widgets).toHaveLength(2);
    expect(info.fields.find(f => f.name === "notes")?.widgets[0].page).toBe(2);
    expect(info.fields.find(f => f.name === "reference")?.readOnly).toBe(true);
  });
  it("persists canonical values and appearance streams while preserving source", async () => {
    const original = await fixture(), copy = original.slice(), output = await fill(original, valid), doc = await PDFDocument.load(output), form = doc.getForm();
    expect(original).toEqual(copy);
    expect(form.getTextField("person.name").getText()).toBe("Ada Lovelace");
    expect(form.getCheckBox("consent").isChecked()).toBe(true);
    expect(form.getDropdown("country").getSelected()).toEqual(["France"]);
    expect(form.getOptionList("interests").getSelected()).toEqual(["Science", "Art"]);
    expect(form.getRadioGroup("plan").getSelected()).toBe("Plus");
    expect(form.getTextField("reference").getText()).toBe("LOCKED");
    for (const field of form.getFields()) for (const widget of field.acroField.getWidgets()) expect(widget.dict.lookup(PDFName.of("AP"), PDFDict).has(PDFName.of("N"))).toBe(true);
  });
  it("flattens all fields and removes the field tree and every Widget", async () => {
    const output = await fill(await fixture(), valid, true), doc = await PDFDocument.load(output);
    expect(doc.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    for (const page of doc.getPages()) for (const ref of page.node.Annots()?.asArray() ?? []) expect(doc.context.lookup(ref, PDFDict).get(PDFName.of("Subtype"))?.toString()).not.toBe("/Widget");
  });
  it("previews an incomplete form but prevents saving it", async () => {
    const bytes = await fixture();
    await expect(fill(bytes, {}, false, true)).resolves.toBeInstanceOf(Uint8Array);
    await expect(fill(bytes, {})).rejects.toMatchObject({ key: "error.required" });
  });
  it("validates mappings without partial changes", async () => {
    const info = await inspect(await fixture());
    for (const [values, key] of [ [{ missing: "x" }, "error.unknown"], [{ consent: "yes" }, "error.boolean"], [{ reference: "change" }, "error.readOnly"], [{ country: "Nowhere" }, "error.choice"], [{ "person.name": "x".repeat(31) }, "error.length"], [{ interests: "Art" }, "error.choice"] ] as const) {
      expect(() => validate(info.fields, values, false)).toThrowError(expect.objectContaining({ key }));
    }
  });
  it("clears checkbox, radio, dropdown and multi-select values", async () => {
    const filled = await fill(await fixture(), valid);
    const output = await fill(filled, { consent: false, plan: "", country: "", interests: [] }, false, true);
    const form = (await PDFDocument.load(output)).getForm();
    expect(form.getCheckBox("consent").isChecked()).toBe(false); expect(form.getRadioGroup("plan").getSelected()).toBeUndefined(); expect(form.getDropdown("country").getSelected()).toEqual([]); expect(form.getOptionList("interests").getSelected()).toEqual([]);
  });
  it("rejects unrenderable text instead of silently producing a broken PDF", async () => {
    await expect(fill(await fixture(), { ...valid, "person.name": "مرحبا" })).rejects.toMatchObject({ key: "error.appearance", vars: { name: "person.name" } });
  });
  it("rejects malformed, oversized and XFA input before form mutation", async () => {
    await expect(inspect(new Uint8Array())).rejects.toMatchObject({ key: "error.fileSize" });
    await expect(inspect(new TextEncoder().encode("not PDF"))).rejects.toMatchObject({ key: "error.pdf" });
    await expect(inspect(new Uint8Array(50 * 1024 * 1024 + 1))).rejects.toMatchObject({ key: "error.fileSize" });
    const doc = await PDFDocument.load(await fixture()); doc.getForm().acroForm.dict.set(PDFName.of("XFA"), PDFString.of("xfa"));
    await expect(inspect(await doc.save({ updateFieldAppearances: false }))).rejects.toMatchObject({ key: "error.xfa" });
  });
  it("creates independent batch forms and validates all rows before export", async () => {
    const bytes = await fixture(), output = await batch(bytes, valid, [{ "person.name": "Alice" }, { "person.name": "Bob" }], false), files = unzipSync(output.bytes);
    expect(Object.keys(files)).toEqual(["form-001.pdf", "form-002.pdf"]);
    for (const [i, name] of ["Alice", "Bob"].entries()) expect((await PDFDocument.load(files[`form-00${i + 1}.pdf`])).getForm().getTextField("person.name").getText()).toBe(name);
    await expect(batch(bytes, valid, [{}, { country: "Unknown" }], false)).rejects.toMatchObject({ key: "error.choice", vars: { row: 2 } });
    await expect(batch(bytes, valid, [], false)).rejects.toMatchObject({ key: "error.rows" });
  });
  it("identifies signatures and prevents flattening specialized fields", async () => {
    const doc = await PDFDocument.load(await fixture()), form = doc.getForm();
    const field = form.getTextField("reference");
    field.acroField.dict.set(PDFName.of("FT"), PDFName.of("Sig"));
    field.acroField.dict.set(PDFName.of("V"), doc.context.obj({ Type: "Sig" }));
    const bytes = await doc.save({ updateFieldAppearances: false });
    expect((await inspect(bytes)).signed).toBe(true);
    await expect(fill(bytes, valid, true)).rejects.toMatchObject({ key: "error.flattenUnsupported" });
  });
  it("rejects encrypted PDFs and preserves unrelated annotations on flatten", async () => {
    const encrypted = await PDFDocument.load(await fixture());
    encrypted.context.trailerInfo.Encrypt = encrypted.context.register(encrypted.context.obj({ Filter: "Standard" }));
    await expect(inspect(await encrypted.save({ updateFieldAppearances: false }))).rejects.toMatchObject({ key: "error.encrypted" });
    const doc = await PDFDocument.load(await fixture());
    const link = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [10, 10, 30, 30] }));
    doc.getPage(0).node.addAnnot(link);
    const flat = await PDFDocument.load(await fill(await doc.save(), valid, true));
    const annotations = flat.getPage(0).node.Annots()!.asArray();
    expect(annotations).toHaveLength(1);
    expect(flat.context.lookup(annotations[0], PDFDict).get(PDFName.of("Subtype"))?.toString()).toBe("/Link");
  });
  it("handles required boolean states", () => { expect(empty(true)).toBe(false); expect(empty(false)).toBe(true); expect(empty([])).toBe(true); expect(empty(" ")).toBe(true); });
});

suite("JSON / CSV mapping", () => {
  it("accepts one object, batches, booleans, arrays, BOM and omitted fields", async () => {
    const { fields } = await inspect(await fixture());
    expect(parseMapping('\uFEFF{"person.name":"Ada","consent":true}', "json", fields)).toEqual([{ "person.name": "Ada", consent: true }]);
    expect(parseMapping('person.name,consent,interests\r\n"Lovelace, Ada",1,"[""Art""]"\r\nBob,false,[]\r\n', "csv", fields)).toEqual([{ "person.name": "Lovelace, Ada", consent: true, interests: ["Art"] }, { "person.name": "Bob", consent: false, interests: [] }]);
  });
  it("parses quoted newlines and escaped quotes", () => { expect(csvRows('name,notes\nAda,"a\nb ""quote"""')).toEqual([["name", "notes"], ["Ada", 'a\nb "quote"']]); });
  it("rejects malformed CSV, duplicate headers, invalid JSON, values and unknown keys", async () => {
    const { fields } = await inspect(await fixture());
    for (const [text, format] of [['name,name\na,b', 'csv'], ['notes\n"unclosed', 'csv'], ['notes\n"a"x', 'csv'], ['notes,country\none', 'csv'], ['{', 'json'], ['[1]', 'json'], ['{"notes":null}', 'json'], ['{"__proto__":"x"}', 'json'], ['consent\nyes', 'csv']] as const) expect(() => parseMapping(text, format, fields)).toThrow();
  });
  it("bounds mapping size and batch row count", async () => {
    const { fields } = await inspect(await fixture());
    expect(() => parseMapping(' '.repeat(2 * 1024 * 1024 + 1), "json", fields)).toThrowError(expect.objectContaining({ key: "error.mappingSize" }));
    expect(() => parseMapping(JSON.stringify(Array.from({ length: 101 }, () => ({}))), "json", fields)).toThrowError(expect.objectContaining({ key: "error.rows" }));
  });
});
