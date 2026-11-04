import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFPage, degrees } from "pdf-lib";
import { zipSync } from "fflate";
import { MAX_FILE_BYTES, MAX_PAGES, MAX_SESSION_BYTES, imageSize, inputKind } from "./limits";
import { CodedError } from "./errors";
import { SCALE_MAX, SCALE_MIN, turnCrop, validCrop, type Crop } from "./geometry";

/** `crop` and `scale` are per page-instance: duplicates of one source page can differ. */
export type Page = { id: string; sourceId: string; index: number; rotation: number; crop?: Crop; scale?: number };
export type Source = { id: string; name: string; bytes: Uint8Array; report: Report; count: number };
export type Metadata = { title?: string; author?: string; subject?: string; keywords?: string };
export type Report = { forms: number; outlines: boolean; signatures: boolean; annotations: number; info?: Metadata };
export type ImportResult = { bytes: Uint8Array; count: number; report: Report };
export type MergeOptions = { cols: number; rows: number; order: "rows" | "columns" };
export type Request =
  | { kind: "import"; bytes: Uint8Array }
  | { kind: "export"; sources: Source[]; pages: Page[]; groups: number[][]; metadata?: Metadata }
  | { kind: "blank"; width: number; height: number }
  | ({ kind: "merge"; sources: Source[]; pages: Page[] } & MergeOptions);

async function load(bytes: Uint8Array) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  } catch (error) {
    if (error instanceof Error && /encrypt/i.test(error.message)) throw new CodedError("engine.encrypted");
    throw new CodedError("engine.unreadable");
  }
}

function inspect(document: PDFDocument): Report {
  const form = document.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (form?.has(PDFName.of("XFA"))) throw new CodedError("engine.xfa");
  const signatures = document.context.enumerateIndirectObjects().some(([, value]) => value instanceof PDFDict &&
    (value.get(PDFName.of("Type"))?.toString() === "/Sig" || value.get(PDFName.of("FT"))?.toString() === "/Sig"));
  return {
    forms: document.getForm().getFields().length,
    outlines: document.catalog.has(PDFName.of("Outlines")),
    signatures,
    annotations: document.getPages().reduce((count, page) => count + (page.node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.size() ?? 0), 0),
    info: { title: document.getTitle(), author: document.getAuthor(), subject: document.getSubject(), keywords: document.getKeywords() },
  };
}

/** Internal links point at other pages; copyPages would drag those (possibly deleted) pages into the output. */
function stripInternalLinks(document: PDFDocument) {
  for (const page of document.getPages()) {
    const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annotations) continue;
    for (let i = 0; i < annotations.size(); i++) {
      const annotation = document.context.lookup(annotations.get(i));
      if (!(annotation instanceof PDFDict) || annotation.get(PDFName.of("Subtype"))?.toString() !== "/Link") continue;
      annotation.delete(PDFName.of("Dest"));
      const action = annotation.lookupMaybe(PDFName.of("A"), PDFDict);
      if (action && action.get(PDFName.of("S"))?.toString() === "/GoTo") annotation.delete(PDFName.of("A"));
    }
  }
}

export async function importDocument(bytes: Uint8Array): Promise<ImportResult> {
  const kind = inputKind(bytes);
  let document: PDFDocument;
  if (kind === "pdf") document = await load(bytes);
  else {
    imageSize(bytes, kind);
    document = await PDFDocument.create();
    const image = kind === "png" ? await document.embedPng(bytes) : await document.embedJpg(bytes);
    const page = document.addPage([image.width * 0.75, image.height * 0.75]);
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    bytes = await document.save();
  }
  const count = document.getPageCount();
  if (!count || count > MAX_PAGES) throw new CodedError("engine.pageCount");
  return { bytes, count, report: inspect(document) };
}

/** Loads a source once per run, drops internal links and flattens forms (see notes in exportDocument). */
async function prepared(documents: Map<string, PDFDocument>, sources: Source[], sourceId: string) {
  let document = documents.get(sourceId);
  if (document) return document;
  const source = sources.find(source => source.id === sourceId);
  if (!source || source.bytes.length > MAX_FILE_BYTES) throw new CodedError("engine.sourceUnavailable");
  document = await load(source.bytes);
  // XFA was rejected at import; no need to re-scan every object here (finding #7).
  stripInternalLinks(document);
  // Keep existing appearances; regenerating them with Helvetica can lose non-Latin form values.
  if (document.getForm().getFields().length) {
    document.getForm().flatten({ updateFieldAppearances: false });
    // pdf-lib can leave orphan widgets after flattening; the appearances are already drawn.
    for (const page of document.getPages()) {
      const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annotations) continue;
      for (let i = annotations.size() - 1; i >= 0; i--) {
        const annotation = document.context.lookup(annotations.get(i));
        if (!(annotation instanceof PDFDict) || annotation.get(PDFName.of("Subtype"))?.toString() === "/Widget") annotations.remove(i);
      }
    }
  }
  documents.set(sourceId, document);
  return document;
}

function checkPage(page: Page, count: number) {
  if (!Number.isInteger(page.rotation) || page.rotation % 90 !== 0) throw new CodedError("engine.badRotation");
  if (page.crop !== undefined && !validCrop(page.crop)) throw new CodedError("engine.badCrop");
  if (page.scale !== undefined && !(page.scale >= SCALE_MIN && page.scale <= SCALE_MAX)) throw new CodedError("engine.badScale");
  if (!Number.isInteger(page.index) || page.index < 0 || page.index >= count) throw new CodedError("engine.pageUnavailable");
}

/** Applies the page's crop (hides everything outside a smaller box) and scale to a copied page. Rotation is applied by the caller. */
function shape(copy: PDFPage, page: Page) {
  if (page.crop) {
    // The crop was chosen on the page as displayed (source /Rotate applied); boxes live in unrotated space.
    const [left, top, right, bottom] = turnCrop(page.crop, -copy.getRotation().angle / 90);
    const box = copy.getCropBox();
    const x = box.x + left * box.width, y = box.y + bottom * box.height;
    const width = box.width * (1 - left - right), height = box.height * (1 - top - bottom);
    copy.setCropBox(x, y, width, height);
    copy.setMediaBox(x, y, width, height);
  }
  if (page.scale !== undefined && page.scale !== 1) copy.scale(page.scale, page.scale);
}

const clean = (value: string | undefined) => (value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500);

export async function exportDocument(sources: Source[], pages: Page[], groups: number[][], metadata: Metadata = {}) {
  if (!pages.length || pages.length > MAX_PAGES || !groups.length || groups.length > MAX_PAGES) throw new CodedError("engine.exportRange");
  if (sources.reduce((size, source) => size + source.bytes.length, 0) > MAX_SESSION_BYTES) throw new CodedError("engine.sessionSize");
  if (groups.reduce((count, group) => count + group.length, 0) > MAX_PAGES) throw new CodedError("limit.exportMax");
  const documents = new Map<string, PDFDocument>();
  const files: Record<string, Uint8Array> = {};
  let outputBytes = 0;
  for (const [groupIndex, group] of groups.entries()) {
    if (!group.length) throw new CodedError("engine.emptyOutput");
    const output = await PDFDocument.create();
    for (const position of group) {
      if (!Number.isInteger(position) || position < 0 || position >= pages.length) throw new CodedError("engine.badOutputPage");
      const page = pages[position];
      const document = await prepared(documents, sources, page.sourceId);
      checkPage(page, document.getPageCount());
      const [copy] = await output.copyPages(document, [page.index]);
      shape(copy, page);
      copy.setRotation(degrees(((copy.getRotation().angle + page.rotation) % 360 + 360) % 360));
      output.addPage(copy);
    }
    if (metadata.title !== undefined) output.setTitle(clean(metadata.title));
    if (metadata.author !== undefined) output.setAuthor(clean(metadata.author));
    if (metadata.subject !== undefined) output.setSubject(clean(metadata.subject));
    if (metadata.keywords !== undefined) output.setKeywords(clean(metadata.keywords).split(",").map(word => word.trim()).filter(Boolean));
    const bytes = await output.save();
    outputBytes += bytes.length;
    if (outputBytes > MAX_FILE_BYTES) throw new CodedError("engine.outputSize");
    files[`part-${String(groupIndex + 1).padStart(3, "0")}.pdf`] = bytes;
  }
  const bytes = groups.length === 1 ? Object.values(files)[0] : zipSync(files, { level: 0 });
  if (bytes.length > MAX_FILE_BYTES) throw new CodedError("engine.zipSize");
  return { bytes, extension: groups.length === 1 ? "pdf" : "zip" };
}

export async function blankDocument(width: number, height: number): Promise<ImportResult> {
  if (!(width >= 1 && width <= 14400 && height >= 1 && height <= 14400)) throw new CodedError("engine.blankSize");
  const document = await PDFDocument.create();
  document.addPage([width, height]);
  return { bytes: await document.save(), count: 1, report: inspect(document) };
}

/** N-up: places the pages on sheets of cols×rows cells, each cell as large as the largest displayed page. */
export async function mergePages(sources: Source[], pages: Page[], { cols, rows, order }: MergeOptions): Promise<ImportResult> {
  const grid = (value: number) => Number.isInteger(value) && value >= 1 && value <= 10;
  if (!grid(cols) || !grid(rows) || cols * rows < 2 || (order !== "rows" && order !== "columns")) throw new CodedError("engine.layout");
  if (pages.length < 2 || pages.length > MAX_PAGES) throw new CodedError("engine.mergeSelect");
  const documents = new Map<string, PDFDocument>();
  const output = await PDFDocument.create();
  const items = [];
  for (const page of pages) {
    const document = await prepared(documents, sources, page.sourceId);
    checkPage(page, document.getPageCount());
    const [copy] = await output.copyPages(document, [page.index]);
    shape(copy, page);
    const turn = ((copy.getRotation().angle + page.rotation) % 360 + 360) % 360;
    const box = copy.getCropBox();
    // pdf-lib cannot embed a page without a content stream; such a (blank) page simply leaves its cell empty.
    const embedded = copy.node.Contents() ? await output.embedPage(copy, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height }) : undefined;
    const sideways = turn === 90 || turn === 270;
    items.push({ embedded, turn, width: box.width, height: box.height, shownWidth: sideways ? box.height : box.width, shownHeight: sideways ? box.width : box.height });
  }
  const cellWidth = Math.max(...items.map(item => item.shownWidth)), cellHeight = Math.max(...items.map(item => item.shownHeight));
  const perSheet = cols * rows;
  for (let first = 0; first < items.length; first += perSheet) {
    const sheet = output.addPage([cols * cellWidth, rows * cellHeight]);
    items.slice(first, first + perSheet).forEach((item, slot) => {
      const row = order === "rows" ? Math.floor(slot / cols) : slot % rows, column = order === "rows" ? slot % cols : Math.floor(slot / rows);
      const fit = Math.min(cellWidth / item.shownWidth, cellHeight / item.shownHeight);
      const left = column * cellWidth + (cellWidth - item.shownWidth * fit) / 2, bottom = (rows - 1 - row) * cellHeight + (cellHeight - item.shownHeight * fit) / 2;
      // A clockwise turn about the drawing origin moves the box; shift the origin so it lands inside the cell.
      const shift = { 0: [0, 0], 90: [0, item.width], 180: [item.width, item.height], 270: [item.height, 0] }[item.turn]!;
      if (item.embedded) sheet.drawPage(item.embedded, { x: left + shift[0] * fit, y: bottom + shift[1] * fit, width: item.width * fit, height: item.height * fit, rotate: degrees(-item.turn) });
    });
  }
  const bytes = await output.save();
  if (bytes.length > MAX_FILE_BYTES) throw new CodedError("engine.mergedSize");
  return { bytes, count: output.getPageCount(), report: inspect(output) };
}
