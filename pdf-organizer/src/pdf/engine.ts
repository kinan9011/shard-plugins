import { PDFArray, PDFDict, PDFDocument, PDFName, degrees } from "pdf-lib";
import { zipSync } from "fflate";
import { MAX_FILE_BYTES, MAX_PAGES, MAX_SESSION_BYTES, imageSize, inputKind } from "./limits";

export type Page = { id: string; sourceId: string; index: number; rotation: number };
export type Source = { id: string; name: string; bytes: Uint8Array; report: Report; count: number };
export type Report = { forms: number; outlines: boolean; signatures: boolean; annotations: number };
export type ImportResult = { bytes: Uint8Array; count: number; report: Report };
export type Request =
  | { kind: "import"; bytes: Uint8Array }
  | { kind: "export"; sources: Source[]; pages: Page[]; groups: number[][] };

async function load(bytes: Uint8Array) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  } catch (error) {
    if (error instanceof Error && /encrypt/i.test(error.message)) throw new Error("Encrypted PDFs are not supported. Use an authorized unencrypted copy.");
    throw new Error("This PDF could not be read. It may be damaged or unsupported.");
  }
}

function inspect(document: PDFDocument): Report {
  const form = document.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (form?.has(PDFName.of("XFA"))) throw new Error("XFA forms are not supported. Export a standard PDF copy first.");
  const signatures = document.context.enumerateIndirectObjects().some(([, value]) => value instanceof PDFDict &&
    (value.get(PDFName.of("Type"))?.toString() === "/Sig" || value.get(PDFName.of("FT"))?.toString() === "/Sig"));
  return {
    forms: document.getForm().getFields().length,
    outlines: document.catalog.has(PDFName.of("Outlines")),
    signatures,
    annotations: document.getPages().reduce((count, page) => count + (page.node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.size() ?? 0), 0),
  };
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
  if (!count || count > MAX_PAGES) throw new Error("Import a document with 1–500 pages.");
  return { bytes, count, report: inspect(document) };
}

export async function exportDocument(sources: Source[], pages: Page[], groups: number[][]) {
  if (!pages.length || pages.length > MAX_PAGES || !groups.length || groups.length > MAX_PAGES) throw new Error("Export 1–500 pages.");
  if (sources.reduce((size, source) => size + source.bytes.length, 0) > MAX_SESSION_BYTES) throw new Error("Session exceeds 100 MiB.");
  if (groups.reduce((count, group) => count + group.length, 0) > MAX_PAGES) throw new Error("Export at most 500 pages at a time.");
  const documents = new Map<string, PDFDocument>();
  const files: Record<string, Uint8Array> = {};
  let outputBytes = 0;
  for (const [groupIndex, group] of groups.entries()) {
    if (!group.length) throw new Error("Each output must contain a page.");
    const output = await PDFDocument.create();
    for (const position of group) {
      if (!Number.isInteger(position) || position < 0 || position >= pages.length) throw new Error("Invalid output page.");
      const page = pages[position];
      if (!Number.isInteger(page.rotation) || page.rotation % 90 !== 0) throw new Error("Invalid page rotation.");
      let document = documents.get(page.sourceId);
      if (!document) {
        const source = sources.find(source => source.id === page.sourceId);
        if (!source || source.bytes.length > MAX_FILE_BYTES) throw new Error("Source document is unavailable or too large.");
        document = await load(source.bytes);
        inspect(document);
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
        documents.set(page.sourceId, document);
      }
      if (!Number.isInteger(page.index) || page.index < 0 || page.index >= document.getPageCount()) throw new Error("Source page is unavailable.");
      const [copy] = await output.copyPages(document, [page.index]);
      copy.setRotation(degrees(((copy.getRotation().angle + page.rotation) % 360 + 360) % 360));
      output.addPage(copy);
    }
    const bytes = await output.save();
    outputBytes += bytes.length;
    if (outputBytes > MAX_FILE_BYTES) throw new Error("Output exceeds the host's 50 MiB file limit. Export fewer pages.");
    files[`part-${String(groupIndex + 1).padStart(3, "0")}.pdf`] = bytes;
  }
  const bytes = groups.length === 1 ? Object.values(files)[0] : zipSync(files, { level: 0 });
  if (bytes.length > MAX_FILE_BYTES) throw new Error("ZIP exceeds 50 MiB. Export fewer pages.");
  return { bytes, extension: groups.length === 1 ? "pdf" : "zip" };
}
