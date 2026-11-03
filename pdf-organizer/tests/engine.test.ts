// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, degrees } from "pdf-lib";
import { unzipSync } from "fflate";
import { blankDocument, exportDocument, importDocument, mergePages, type Page, type Source } from "../src/pdf/engine";
import { turnCrop } from "../src/pdf/geometry";
import { MAX_FILE_BYTES, everyNPages, imageSize, inputKind, parseRanges } from "../src/pdf/limits";
import { clonePages, cropPages, emptyHistory, historyReducer, insertPages, movePages, resetGeometry, reversePages, scalePages, splitPages } from "../src/pdf/history";

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
    expect(result.report).toMatchObject({ forms: 1, outlines: true, signatures: true, annotations: 2 });
    const output = await exportDocument([{ id: "a", name: "form.pdf", ...result }], [{ id: "p", sourceId: "a", index: 0, rotation: 0 }], [[0]]);
    const parsed = await PDFDocument.load(output.bytes);
    expect(parsed.getForm().getFields()).toHaveLength(0);
    expect(parsed.catalog.has(PDFName.of("Outlines"))).toBe(false);
    const annots = parsed.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annots.size()).toBe(1);
    expect(parsed.context.lookup(annots.get(0))?.toString()).toContain("Keep this note");
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
  const groupPages: Page[] = [..."ABCDE"].map((id, index) => ({ id, index, sourceId: index < 3 ? "a" : "b", rotation: index * 90 }));
  it.each([
    ["BD", "E", true, "ACEBD"], ["BD", "A", false, "BDACE"],
    ["BC", "E", true, "ADEBC"], ["DE", "B", false, "ADEBC"],
    ["A", "E", true, "BCDEA"], ["E", "A", false, "EABCD"],
    ["DB", null, false, "ACEBD"],
  ])("moves %s around %s (after=%s) as a stable block", (ids, target, after, expected) => {
    const moved = movePages(groupPages, new Set(ids), target, after);
    expect(moved.map(page => page.id).join("")).toBe(expected);
    expect(moved.every(page => groupPages.includes(page))).toBe(true);
    expect(groupPages.map(page => page.id).join("")).toBe("ABCDE");
    const edited = historyReducer({ ...emptyHistory, pages: groupPages }, { type: "set", pages: moved });
    const undone = historyReducer(edited, { type: "undo" });
    expect(undone.pages).toBe(groupPages);
    expect(historyReducer(undone, { type: "redo" }).pages).toBe(moved);
  });
  it.each([
    ["BD", "D", true], ["BD", "B", false], ["BC", "D", false],
    ["DE", null, false], ["ABCDE", "C", true], ["", "A", false],
    ["missing", "A", false], ["B", "missing", false],
  ])("keeps no-op %s around %s out of history", (ids, target, after) => {
    expect(movePages(groupPages, new Set(ids === "missing" ? [ids] : ids), target, after)).toBe(groupPages);
  });
  it("undoes/redo imports and edits without mutating the original page list", async () => {
    const { pages } = await fixture();
    const imported = historyReducer(emptyHistory, { type: "set", pages });
    const moved = movePages(pages, new Set([pages[0].id]), pages[2].id, true);
    expect(moved.map(page => page.index)).toEqual([1, 2, 0]);
    expect(pages.map(page => page.index)).toEqual([0, 1, 2]);
    const edited = historyReducer(imported, { type: "set", pages: moved });
    const undone = historyReducer(edited, { type: "undo" });
    expect(undone.pages).toEqual(pages);
    expect(historyReducer(undone, { type: "redo" }).pages).toEqual(moved);
    expect(historyReducer(undone, { type: "set", pages: [] }).future).toEqual([]);
    expect(historyReducer(edited, { type: "reset" })).toEqual(emptyHistory);
  });
  it("does not carry deleted pages into the output through internal links", async () => {
    const document = await PDFDocument.create();
    const first = document.addPage([300, 300]);
    document.addPage([300, 300]);
    const secret = document.addPage([300, 300]);
    secret.drawText("SECRET-PAGE-THREE");
    const link = document.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 50, 50], Dest: [secret.ref, PDFName.of("Fit")] });
    first.node.set(PDFName.of("Annots"), document.context.obj([document.context.register(link)]));
    const result = await importDocument(await document.save());
    const source: Source = { id: "a", name: "linked.pdf", ...result };
    const pages: Page[] = [{ id: "p0", sourceId: "a", index: 0, rotation: 0 }];
    const { bytes } = await exportDocument([source], pages, [[0]]);
    const output = await PDFDocument.load(bytes);
    const pageObjects = output.context.enumerateIndirectObjects().filter(([, value]) => value instanceof PDFDict && value.get(PDFName.of("Type"))?.toString() === "/Page");
    expect(output.getPageCount()).toBe(1);
    expect(pageObjects).toHaveLength(1);
  });
  it("bounds history, and load starts a fresh session", async () => {
    const { pages } = await fixture();
    let history = emptyHistory;
    for (let i = 0; i < 35; i++) history = historyReducer(history, { type: "set", pages });
    expect(history.past).toHaveLength(30);
    expect(historyReducer(history, { type: "load", pages: [] })).toEqual({ past: [], pages: [], future: [] });
  });
  it("clones with fresh ids, inserts relative to a page and reverses within slots", () => {
    const clones = clonePages(groupPages.slice(0, 2));
    expect(clones.map(page => page.index)).toEqual([0, 1]);
    expect(clones.every((page, i) => page.id !== groupPages[i].id && page.sourceId === groupPages[i].sourceId)).toBe(true);
    const ids = (list: Page[]) => list.map(page => page.id).join("");
    const x: Page = { id: "X", index: 9, sourceId: "a", rotation: 0 }, y = { ...x, id: "Y" };
    expect(ids(insertPages(groupPages, [x, y], "B", true))).toBe("ABXYCDE");
    expect(ids(insertPages(groupPages, [x], "B", false))).toBe("AXBCDE");
    expect(ids(insertPages(groupPages, [x], null))).toBe("ABCDEX");
    expect(insertPages(groupPages, [x], "missing")).toBe(groupPages);
    expect(insertPages(groupPages, [], "A")).toBe(groupPages);
    expect(ids(reversePages(groupPages, new Set("ACE")))).toBe("EBCDA");
    expect(ids(reversePages(groupPages, new Set("B")))).toBe("EDCBA");
    expect(ids(reversePages(groupPages, new Set()))).toBe("EDCBA");
    expect(reversePages(groupPages.slice(0, 1), new Set())).toEqual(groupPages.slice(0, 1));
  });
});

describe("truncated JPEG header", () => {
  it("is rejected with a readable error, not a RangeError", () => {
    expect(() => imageSize(Uint8Array.from([255, 216, 255, 255]), "jpeg")).toThrow("valid dimensions");
  });
});

async function plain(sizes: [number, number][], rotations: number[] = []) {
  const document = await PDFDocument.create();
  sizes.forEach(([width, height], index) => { const page = document.addPage([width, height]); if (rotations[index]) page.setRotation(degrees(rotations[index])); });
  const result = await importDocument(await document.save());
  const source: Source = { id: "p", name: "plain.pdf", ...result };
  const pages: Page[] = sizes.map((_, index) => ({ id: `p${index}`, sourceId: "p", index, rotation: 0 }));
  return { source, pages };
}

describe("page geometry", () => {
  it("turns margins with the page and round-trips", () => {
    expect(turnCrop([0.1, 0.2, 0.3, 0.4], 1)).toEqual([0.4, 0.1, 0.2, 0.3]);
    expect(turnCrop(turnCrop([0.1, 0.2, 0.3, 0.4], 1), -1)).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(turnCrop([0.1, 0.2, 0.3, 0.4], 4)).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("crops by shrinking the media and crop boxes, including pages with their own /Rotate", async () => {
    const { source, pages } = await plain([[320, 480], [600, 300]], [0, 90]);
    const result = await exportDocument([source], [{ ...pages[0], crop: [0.25, 0, 0.25, 0.5] }, { ...pages[1], crop: [0.5, 0, 0, 0] }], [[0, 1]]);
    const output = await PDFDocument.load(result.bytes);
    expect(output.getPage(0).getCropBox()).toEqual({ x: 80, y: 240, width: 160, height: 240 });
    expect(output.getPage(0).getSize()).toEqual({ width: 160, height: 240 });
    // Displayed left half of a /Rotate 90 page is the bottom half of its unrotated box.
    expect(output.getPage(1).getCropBox()).toEqual({ x: 0, y: 150, width: 600, height: 150 });
    expect(output.getPage(1).getRotation().angle).toBe(90);
  });

  it("crops relative to an existing CropBox and scales boxes and content", async () => {
    const { source, pages } = await fixture();
    const result = await exportDocument([source], [{ ...pages[1], crop: [0.1, 0.1, 0.1, 0.1], scale: 2 }, { ...pages[0], scale: 0.5 }], [[0, 1]]);
    const output = await PDFDocument.load(result.bytes);
    const box = output.getPage(0).getCropBox();
    expect(box.width).toBeCloseTo(2 * 400); expect(box.height).toBeCloseTo(2 * 0.8 * 250);
    expect(output.getPage(1).getSize()).toEqual({ width: 160, height: 240 });
  });

  it("rejects invalid geometry before building anything", async () => {
    const { source, pages } = await plain([[100, 100]]);
    for (const bad of [{ crop: [0.6, 0, 0.6, 0] }, { crop: [-0.1, 0, 0, 0] }, { crop: [NaN, 0, 0, 0] }, { scale: 0 }, { scale: 5 }, { scale: NaN }]) {
      await expect(exportDocument([source], [{ ...pages[0], ...bad } as Page], [[0]])).rejects.toThrow(/Invalid page (crop|scale)/);
    }
  });

  it("writes document properties to every output", async () => {
    const { source, pages } = await plain([[100, 100], [100, 100]]);
    const result = await exportDocument([source], pages, [[0], [1]], { title: "Quarterly\nreport", author: "Ada", keywords: "a, b" });
    const parts = unzipSync(result.bytes);
    for (const part of Object.values(parts)) {
      const output = await PDFDocument.load(part);
      expect(output.getTitle()).toBe("Quarterly report"); expect(output.getAuthor()).toBe("Ada"); expect(output.getKeywords()).toBe("a b");
    }
    const none = await PDFDocument.load((await exportDocument([source], pages, [[0, 1]])).bytes);
    expect(none.getTitle()).toBeUndefined();
  });

  it("reports existing document properties on import", async () => {
    const document = await PDFDocument.create(); document.addPage([50, 50]); document.setTitle("Existing"); document.setAuthor("Grace");
    expect((await importDocument(await document.save())).report.info).toMatchObject({ title: "Existing", author: "Grace" });
  });

  it("creates a single blank page of the requested size and refuses absurd ones", async () => {
    const blank = await blankDocument(210, 297);
    expect(blank.count).toBe(1);
    expect((await PDFDocument.load(blank.bytes)).getPage(0).getSize()).toEqual({ width: 210, height: 297 });
    await expect(blankDocument(0, 10)).rejects.toThrow("out of range"); await expect(blankDocument(20000, 10)).rejects.toThrow("out of range");
  });

  it("merges pages N-up on sheets sized to the largest displayed page, honouring rotation", async () => {
    const { source, pages } = await plain([[200, 100], [100, 300], [150, 150], [100, 100], [80, 80]], [0, 0, 90, 0, 0]);
    const result = await mergePages([source], pages.slice(0, 4), { cols: 2, rows: 2, order: "rows" });
    expect(result.count).toBe(1);
    const sheet = (await PDFDocument.load(result.bytes)).getPage(0);
    // Displayed sizes: 200x100, 100x300, 150x150 turned to 150x150, 100x100 -> cell 200x300.
    expect(sheet.getSize()).toEqual({ width: 400, height: 600 });
    // The pages have no content stream (genuinely blank), so nothing can be embedded and nothing may crash.
    expect(sheet.node.Resources()?.has(PDFName.of("XObject")) ?? false).toBe(false);
    const two = await mergePages([source], [{ ...pages[2], rotation: 90 }, ...pages], { cols: 3, rows: 1, order: "columns" });
    expect(two.count).toBe(2);
    expect((await PDFDocument.load(two.bytes)).getPage(1).getSize().width).toBe(3 * 200);
  });

  it("refuses unusable merge layouts", async () => {
    const { source, pages } = await plain([[100, 100], [100, 100]]);
    for (const options of [{ cols: 1, rows: 1 }, { cols: 0, rows: 2 }, { cols: 11, rows: 1 }, { cols: 1.5, rows: 2 }]) {
      await expect(mergePages([source], pages, { ...options, order: "rows" })).rejects.toThrow("Choose a layout");
    }
    await expect(mergePages([source], pages.slice(0, 1), { cols: 2, rows: 1, order: "rows" })).rejects.toThrow("Select 2");
  });
});

describe("merge with content", () => {
  it("embeds each page that has content", async () => {
    const document = await PDFDocument.create();
    for (let i = 0; i < 3; i++) document.addPage([100 + i * 10, 100]).drawText(`P${i}`, { x: 10, y: 50 });
    document.addPage([100, 100]);
    const result = await importDocument(await document.save());
    const source: Source = { id: "t", name: "t.pdf", ...result };
    const pages: Page[] = [0, 1, 2, 3].map(index => ({ id: `t${index}`, sourceId: "t", index, rotation: index === 1 ? 90 : 0 }));
    const merged = await mergePages([source], pages, { cols: 2, rows: 2, order: "columns" });
    const sheet = (await PDFDocument.load(merged.bytes)).getPage(0);
    expect(sheet.getSize()).toEqual({ width: 240, height: 220 });
    expect(sheet.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).keys()).toHaveLength(3);
  });
});

describe("geometry edits in history", () => {
  const base: Page[] = [{ id: "a", sourceId: "s", index: 0, rotation: 0 }, { id: "b", sourceId: "s", index: 1, rotation: 90 }, { id: "c", sourceId: "s", index: 2, rotation: 0 }];
  it("crops what is visible, in the orientation shown, and composes", () => {
    const once = cropPages(base, new Set(["a", "b"]), [0.1, 0, 0, 0]);
    expect(once[0].crop).toEqual([0.1, 0, 0, 0]); expect(once[2]).toBe(base[2]);
    // Displayed left of a page turned 90 degrees clockwise is its original bottom.
    expect(once[1].crop).toEqual([0, 0, 0, 0.1]);
    const twice = cropPages(once, new Set(["a"]), [0.1, 0, 0, 0]);
    expect(twice[0].crop![0]).toBeCloseTo(0.1 + 0.1 * 0.9);
    expect(base[0].crop).toBeUndefined();
  });
  it("scales, resets and keeps unchanged pages identical", () => {
    const scaled = scalePages(base, new Set(["a"]), 1.5);
    expect(scaled[0].scale).toBe(1.5); expect(scaled[1]).toBe(base[1]);
    expect(scalePages(scaled, new Set(["a"]), 1)[0].scale).toBeUndefined();
    const geometry = cropPages(scaled, new Set(["a"]), [0.2, 0.2, 0, 0]);
    expect(resetGeometry(geometry, new Set(["a"]))[0]).toEqual(base[0]);
    expect(resetGeometry(base, new Set(["a"]))[0]).toBe(base[0]);
  });
  it("splits into cells in displayed reading order with fresh ids", () => {
    const { pages, created } = splitPages(base, new Set(["a", "b"]), 2, 1);
    expect(pages).toHaveLength(5); expect(created).toHaveLength(4);
    expect(pages.slice(0, 2).map(page => page.crop)).toEqual([[0, 0, 0.5, 0], [0.5, 0, 0, 0]]);
    expect(pages[1].id).not.toBe("a"); expect(pages[4]).toBe(base[2]);
    // Page b is displayed turned 90 degrees clockwise: its displayed left half is its original bottom half (hide the top).
    expect(pages.slice(2, 4).map(page => page.crop)).toEqual([[0, 0.5, 0, 0], [0, 0, 0, 0.5]]);
    expect(splitPages(base, new Set(["a"]), 1, 1)).toEqual({ pages: base, created: [] });
    const grid = splitPages(base.slice(0, 1), new Set(["a"]), 2, 2).pages.map(page => page.crop);
    expect(grid).toEqual([[0, 0, 0.5, 0.5], [0.5, 0, 0, 0.5], [0, 0.5, 0.5, 0], [0.5, 0.5, 0, 0]]);
  });
});
