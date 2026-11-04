// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFString, StandardFonts, degrees, rgb } from "pdf-lib";
import { unzlibSync } from "fflate";
import { processRequest, type RasterPage, type Report } from "../src/pdf/engine";
import { DEFAULT_OPTIONS, MAX_FILE_BYTES, monochrome, rasterSize, validateOptions } from "../src/pdf/options";

async function fixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([240, 320]);
  page.drawText("Keep this text", { x: 20, y: 270, size: 14, font, color: rgb(0.8, 0, 0.2) });
  page.setRotation(degrees(90));
  doc.setTitle("Original title"); doc.setAuthor("Original author");
  const field = doc.getForm().createTextField("name");
  field.setText("Ada"); field.addToPage(page, { x: 20, y: 170, width: 150, height: 24 });
  doc.getForm().updateFieldAppearances(font);
  const metadata = doc.context.stream("<metadata>private metadata</metadata>", { Type: "Metadata", Subtype: "XML" });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(metadata));
  const outline = doc.context.obj({ Type: "Outlines", Count: 0 });
  doc.catalog.set(PDFName.of("Outlines"), doc.context.register(outline));
  await doc.attach(new TextEncoder().encode("private attachment"), "private.txt");
  doc.context.register(doc.context.stream("unreachable private data ".repeat(5000)));
  const stream = doc.context.stream("% repetitive content\n".repeat(2000));
  page.node.addContentStream(doc.context.register(stream));
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}
async function output(options = {}, pages?: RasterPage[]) {
  return processRequest({ kind: "compress", bytes: await fixture(), options: { ...DEFAULT_OPTIONS, ...options }, pages }) as Promise<Uint8Array>;
}

describe("real PDF compression", () => {
  it("inspects page and form counts without modifying source", async () => {
    const bytes = await fixture(), copy = bytes.slice();
    expect(await processRequest({ kind: "inspect", bytes })).toEqual({ pages: 1, forms: 1, signatures: false });
    expect(bytes).toEqual(copy);
  });
  it("compresses streams and prunes garbage while preserving rotation and editable fields", async () => {
    const bytes = await fixture();
    const result = await processRequest({ kind: "compress", bytes, options: { ...DEFAULT_OPTIONS, removeMetadata: false } }) as Uint8Array;
    expect(result.length).toBeLessThan(bytes.length / 3);
    const doc = await PDFDocument.load(result, { updateMetadata: false });
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getTitle()).toBe("Original title");
    expect(doc.getForm().getTextField("name").getText()).toBe("Ada");
    expect(doc.catalog.has(PDFName.of("Outlines"))).toBe(true);
    const text = new TextDecoder().decode(result);
    expect(text).not.toContain("unreachable private data");
    const streams = doc.context.enumerateIndirectObjects().map(([, o]) => o).filter(o => o instanceof PDFRawStream);
    expect(streams.some(o => o.dict.get(PDFName.of("Filter")) === PDFName.of("FlateDecode"))).toBe(true);
  });
  it("removes Info and XMP metadata", async () => {
    const doc = await PDFDocument.load(await output(), { updateMetadata: false });
    expect(doc.context.trailerInfo.Info).toBeUndefined();
    expect(doc.catalog.has(PDFName.of("Metadata"))).toBe(false);
    expect(doc.getTitle()).toBeUndefined();
  });
  it("removes attachments and bookmarks only on request", async () => {
    const keep = await PDFDocument.load(await output());
    expect(keep.catalog.lookup(PDFName.of("Names"), PDFDict).has(PDFName.of("EmbeddedFiles"))).toBe(true);
    const doc = await PDFDocument.load(await output({ removeExtras: true }));
    expect(doc.catalog.has(PDFName.of("Outlines"))).toBe(false);
    expect(doc.catalog.lookup(PDFName.of("Names"), PDFDict).has(PDFName.of("EmbeddedFiles"))).toBe(false);
    expect(doc.context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of("Type")) === PDFName.of("EmbeddedFile"))).toBe(false);
  });
  it("flattens fields and removes all widgets and the field tree", async () => {
    const doc = await PDFDocument.load(await output({ flattenForms: true }));
    expect(doc.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    const annotations = doc.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    expect(annotations?.size() ?? 0).toBe(0);
    expect(doc.getPage(0).node.Contents()).toBeDefined();
  });
  it("builds true 1-bit DeviceGray pages, with original metadata when requested", async () => {
    const bytes = new Uint8Array([0b10101010, 0b01010101]);
    const result = await output({ mode: "raster", color: "bw", removeMetadata: false }, [{ bytes, width: 8, height: 2, pointsWidth: 320, pointsHeight: 240, mono: true }]);
    const doc = await PDFDocument.load(result, { updateMetadata: false });
    expect(doc.getPage(0).getSize()).toEqual({ width: 320, height: 240 });
    expect(doc.getTitle()).toBe("Original title");
    expect(doc.catalog.has(PDFName.of("Metadata"))).toBe(true);
    expect(doc.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    expect(doc.catalog.has(PDFName.of("Names"))).toBe(false);
    const image = doc.context.enumerateIndirectObjects().map(([, o]) => o).find(o => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) as PDFRawStream;
    expect(image.dict.lookup(PDFName.of("BitsPerComponent"), PDFNumber).asNumber()).toBe(1);
    expect(image.dict.get(PDFName.of("ColorSpace"))).toBe(PDFName.of("DeviceGray"));
    expect(unzlibSync(image.contents)).toEqual(bytes);
  });
  it("rejects mismatched raster page count or invalid bitmap length", async () => {
    await expect(output({ mode: "raster" }, [])).rejects.toThrow("error.pages");
    await expect(output({ mode: "raster", color: "bw" }, [{ bytes: new Uint8Array(1), width: 16, height: 2, pointsWidth: 320, pointsHeight: 240, mono: true }])).rejects.toThrow("error.dimensions");
  });
  it("detects signature fields", async () => {
    const doc = await PDFDocument.load(await fixture());
    doc.catalog.set(PDFName.of("DummySig"), doc.context.register(doc.context.obj({ Type: "Sig" })));
    const report = await processRequest({ kind: "inspect", bytes: await doc.save() }) as Report;
    expect(report.signatures).toBe(true);
  });
  it("rejects XFA, encrypted, malformed and empty files", async () => {
    const doc = await PDFDocument.load(await fixture());
    doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict).set(PDFName.of("XFA"), PDFString.of("dynamic"));
    await expect(processRequest({ kind: "inspect", bytes: await doc.save() })).rejects.toThrow("error.xfa");
    const encrypted = await PDFDocument.create(); encrypted.addPage();
    encrypted.context.trailerInfo.Encrypt = encrypted.context.register(encrypted.context.obj({ Filter: "Standard", V: 1 }));
    await expect(processRequest({ kind: "inspect", bytes: await encrypted.save() })).rejects.toThrow("error.encrypted");
    await expect(processRequest({ kind: "inspect", bytes: new TextEncoder().encode("not a pdf") })).rejects.toThrow("error.pdf");
    await expect(processRequest({ kind: "inspect", bytes: new Uint8Array() })).rejects.toThrow("error.fileSize");
    await expect(processRequest({ kind: "inspect", bytes: new Uint8Array(MAX_FILE_BYTES + 1) })).rejects.toThrow("error.fileSize");
  });
});

describe("compression controls", () => {
  it("validates all options at the engine boundary", () => {
    expect(() => validateOptions(DEFAULT_OPTIONS)).not.toThrow();
    for (const patch of [{ dpi: NaN }, { dpi: 301 }, { quality: 0 }, { quality: 100.5 }, { threshold: 255 }, { mode: "unknown" }, { color: "gray" }, { removeMetadata: 1 }]) {
      expect(() => validateOptions({ ...DEFAULT_OPTIONS, ...patch } as never)).toThrow("error.options");
    }
  });
  it("uses requested DPI without secretly reducing it", () => {
    expect(rasterSize(612, 792, 150)).toEqual({ width: 1275, height: 1650, scale: 150 / 72 });
    expect(() => rasterSize(10000, 10000, 300)).toThrow("error.pixels");
    expect(() => rasterSize(0, 100, 150)).toThrow("error.dimensions");
  });
  it("packs monochrome rows with padding and composites transparency onto white", () => {
    const rgba = new Uint8ClampedArray([0,0,0,255, 255,255,255,255, 0,0,0,0, 200,200,200,255, 0,0,0,255, 255,255,255,255]);
    expect(monochrome(rgba, 3, 2, 160)).toEqual(new Uint8Array([0b01111111, 0b10111111]));
    expect(monochrome(rgba, 3, 2, 220)).toEqual(new Uint8Array([0b01111111, 0b00111111]));
  });
});
