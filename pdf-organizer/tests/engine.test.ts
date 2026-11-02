// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDocument, PDFName, PDFString, StandardFonts, degrees } from "pdf-lib";
import { unzipSync } from "fflate";
import { exportDocument, importDocument, type Page, type Source } from "../src/pdf/engine";
import { MAX_FILE_BYTES, everyNPages, imageSize, inputKind, parseRanges } from "../src/pdf/limits";
import { emptyHistory, historyReducer, movePage, moveSource } from "../src/pdf/history";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
async function fixture() {
  const document = await PDFDocument.create();
  document.addPage([320, 480]);
  const landscape = document.addPage([600, 300]);
  landscape.setRotation(degrees(90));
  landscape.setCropBox(10, 20, 500, 250);
  document.addPage([200, 400]);
  const result = await importDocument(await document.save());
  const source: Source = { id: "a", name: "fixture.pdf", ...result };
  const pages: Page[] = Array.from({ length: result.count }, (_, index) => ({ id: `page-${index}`, sourceId: source.id, index, rotation: 0 }));
  return { document, source, pages };
}

describe("real PDF assembly", () => {
  it("reorders and rotates pages without changing their media/crop boxes", async () => {
    const { source, pages } = await fixture();
    const result = await exportDocument([source], [{ ...pages[1], rotation: 90 }, pages[0]], [[0, 1]]);
    const output = await PDFDocument.load(result.bytes);
    expect(output.getPageCount()).toBe(2);
    expect(output.getPage(0).getSize()).toEqual({ width: 600, height: 300 });
    expect(output.getPage(0).getCropBox()).toEqual({ x: 10, y: 20, width: 500, height: 250 });
    expect(output.getPage(0).getRotation().angle).toBe(180);
    expect(output.getPage(1).getSize()).toEqual({ width: 320, height: 480 });
  });

  it("merges PDFs and a real PNG, duplicates, extracts and splits into valid PDFs", async () => {
    const { source, pages } = await fixture();
    const image: Source = { id: "image", name: "pixel.png", ...await importDocument(png) };
    const merged = [...pages, { id: "image-page", sourceId: "image", index: 0, rotation: 0 }, pages[0]];
    const result = await exportDocument([source, image], merged, [[3, 0, 4], [1, 2]]);
    expect(result.extension).toBe("zip");
    const pieces = unzipSync(result.bytes);
    expect(Object.keys(pieces)).toEqual(["part-001.pdf", "part-002.pdf"]);
    const first = await PDFDocument.load(pieces["part-001.pdf"]);
    expect(first.getPageCount()).toBe(3);
    expect(first.getPage(0).getSize()).toEqual({ width: 0.75, height: 0.75 });
    expect(first.getPage(1).getSize()).toEqual(first.getPage(2).getSize());
    expect((await PDFDocument.load(pieces["part-002.pdf"])).getPageCount()).toBe(2);
  });

  it("reports and flattens form appearances, drops outlines and copies a text annotation", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const field = document.getForm().createTextField("name");
    field.setText("Visible value");
    field.addToPage(page, { x: 20, y: 40, width: 180, height: 30, font });
    document.getForm().updateFieldAppearances(font);
    const note = document.context.register(document.context.obj({ Type: "Annot", Subtype: "Text", Rect: [10, 10, 20, 20], Contents: PDFString.of("Keep this note") }));
    page.node.lookup(PDFName.of("Annots"), PDFArray).push(note);
    document.catalog.set(PDFName.of("Outlines"), document.context.register(document.context.obj({ Type: "Outlines", Count: 0 })));
    document.context.register(document.context.obj({ Type: "Sig", Filter: "Adobe.PPKLite" }));
    const result = await importDocument(await document.save());
    expect(result.report).toEqual({ forms: 1, outlines: true, signatures: true, annotations: 2 });
    const output = await exportDocument([{ id: "a", name: "form.pdf", ...result }], [{ id: "p", sourceId: "a", index: 0, rotation: 0 }], [[0]]);
    const parsed = await PDFDocument.load(output.bytes);
    expect(parsed.getForm().getFields()).toHaveLength(0);
    expect(parsed.catalog.has(PDFName.of("Outlines"))).toBe(false);
    const annots = parsed.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annots.size()).toBe(1);
    expect(parsed.context.lookup(annots.get(0)).toString()).toContain("Keep this note");
    expect(parsed.getPage(0).node.Resources()?.toString()).toContain("/XObject");
  });

  it("rejects encrypted and XFA documents without bypassing restrictions", async () => {
    const encrypted = await PDFDocument.create(); encrypted.addPage();
    encrypted.context.trailerInfo.Encrypt = encrypted.context.register(encrypted.context.obj({ Filter: "Standard" }));
    await expect(importDocument(await encrypted.save())).rejects.toThrow("Encrypted PDFs");
    const xfa = await PDFDocument.create(); xfa.addPage();
    xfa.catalog.set(PDFName.of("AcroForm"), xfa.context.register(xfa.context.obj({ XFA: PDFString.of("unsupported") })));
    await expect(importDocument(await xfa.save())).rejects.toThrow("XFA");
  });

  it("rejects malformed, empty and excessive inputs", async () => {
    await expect(importDocument(new TextEncoder().encode("%PDF-not-a-document"))).rejects.toThrow("could not be read");
    expect(() => inputKind(new Uint8Array())).toThrow("non-empty");
    expect(() => inputKind(new Uint8Array(MAX_FILE_BYTES + 1))).toThrow("50 MiB");
    expect(() => inputKind(new TextEncoder().encode("not PDF"))).toThrow("Unsupported file");
    const document = await PDFDocument.create();
    for (let i = 0; i < 501; i++) document.addPage([1, 1]);
    await expect(importDocument(await document.save())).rejects.toThrow("1–500");
  });

  it("validates output pages and rotation at the worker boundary", async () => {
    const { source, pages } = await fixture();
    await expect(exportDocument([source], pages, [[3]])).rejects.toThrow("Invalid output page");
    await expect(exportDocument([source], pages, [[]])).rejects.toThrow("contain a page");
    await expect(exportDocument([source], [{ ...pages[0], rotation: 1 }], [[0]])).rejects.toThrow("rotation");
    await expect(exportDocument([], pages, [[0]])).rejects.toThrow("unavailable");
    await expect(exportDocument([source], [{ ...pages[0], index: -1 }], [[0]])).rejects.toThrow("Source page");
    await expect(exportDocument([source], pages, [Array(501).fill(0)])).rejects.toThrow("500");
  });
});

describe("ranges and image limits", () => {
  it("parses pieces with explicit ordering and duplicates", () => {
    expect(parseRanges("1-3,5; 2,2", 5)).toEqual([[0, 1, 2, 4], [1, 1]]);
    expect(everyNPages(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(everyNPages(3, 500)).toEqual([[0, 1, 2]]);
  });
  it.each(["", "0", "2-1", "1-6", "1,,2", "1;", "-1", "1.5", "1e2"])('rejects range "%s"', range => {
    expect(() => parseRanges(range, 5)).toThrow();
  });
  it.each([0, -1, 1.5, NaN, 501])("rejects invalid split size %s", size => {
    expect(() => everyNPages(5, size)).toThrow();
  });
  it("rejects excessive expansions and validates raster headers before decoding", () => {
    expect(() => parseRanges("1-500,1", 500)).toThrow("500");
    expect(imageSize(png, "png")).toEqual({ width: 1, height: 1 });
    const oversized = png.slice(); new DataView(oversized.buffer).setUint32(16, 32_000_001);
    expect(() => imageSize(oversized, "png")).toThrow("32 million");
    expect(() => imageSize(new Uint8Array([255, 216, 255]), "jpeg")).toThrow();
    const jpeg = new Uint8Array([255, 216, 255, 192, 0, 11, 8, 0, 30, 0, 40, 1, 1, 17, 0]);
    expect(imageSize(jpeg, "jpeg")).toEqual({ width: 40, height: 30 });
  });
});

describe("session editing history", () => {
  it("undoes/redo imports and edits without mutating the original page list", async () => {
    const { pages } = await fixture();
    const imported = historyReducer(emptyHistory, { type: "set", pages });
    const moved = movePage(pages, pages[0].id, 2);
    expect(moved.map(page => page.index)).toEqual([1, 2, 0]);
    expect(pages.map(page => page.index)).toEqual([0, 1, 2]);
    const edited = historyReducer(imported, { type: "set", pages: moved });
    const undone = historyReducer(edited, { type: "undo" });
    expect(undone.pages).toEqual(pages);
    expect(historyReducer(undone, { type: "redo" }).pages).toEqual(moved);
    expect(historyReducer(undone, { type: "set", pages: [] }).future).toEqual([]);
    expect(historyReducer(edited, { type: "reset" })).toEqual(emptyHistory);
  });
  it("groups file pages in the requested order and bounds history", async () => {
    const { pages } = await fixture();
    const mixed = [pages[0], { ...pages[1], sourceId: "b" }, pages[2]];
    expect(moveSource(mixed, "b", "a").map(page => page.sourceId)).toEqual(["b", "a", "a"]);
    expect(movePage(pages, "missing", 1)).toBe(pages);
    let history = emptyHistory;
    for (let i = 0; i < 35; i++) history = historyReducer(history, { type: "set", pages });
    expect(history.past).toHaveLength(30);
  });
});
