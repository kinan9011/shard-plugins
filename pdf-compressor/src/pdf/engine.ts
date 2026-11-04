import { deflateSync } from "fflate";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFObjectCopier, PDFRawStream, PDFRef, PDFStream, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from "pdf-lib";
import { MAX_FILE_BYTES, MAX_PAGES, MAX_PIXELS, validateOptions, type Options } from "./options";

export type Report = { pages: number; forms: number; signatures: boolean };
export type RasterPage = { bytes: Uint8Array; width: number; height: number; pointsWidth: number; pointsHeight: number; mono: boolean };
export type Request = { kind: "inspect"; bytes: Uint8Array } | { kind: "compress"; bytes: Uint8Array; options: Options; pages?: RasterPage[] };

async function load(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error("error.fileSize");
  if (!new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-")) throw new Error("error.pdf");
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }); }
  catch (error) { throw new Error(error instanceof Error && /encrypt/i.test(error.message) ? "error.encrypted" : "error.pdf"); }
  if (!doc.getPageCount() || doc.getPageCount() > MAX_PAGES) throw new Error("error.pages");
  const form = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (form?.has(PDFName.of("XFA"))) throw new Error("error.xfa");
  return doc;
}

/** Drop unreachable objects after removals, including old images, metadata and attachments. */
function compact(doc: PDFDocument) {
  const seen = new Set<PDFObject>();
  const refs = new Set<string>();
  const pending: PDFObject[] = Object.values(doc.context.trailerInfo).filter((v): v is PDFObject => v !== undefined);
  while (pending.length) {
    const value = pending.pop()!;
    if (seen.has(value)) continue;
    seen.add(value);
    if (value instanceof PDFRef) {
      refs.add(value.toString());
      const object = doc.context.lookup(value);
      if (object) pending.push(object);
    } else if (value instanceof PDFArray) pending.push(...value.asArray());
    else if (value instanceof PDFDict) pending.push(...value.values());
    else if (value instanceof PDFStream) pending.push(value.dict);
  }
  for (const [ref, value] of doc.context.enumerateIndirectObjects()) {
    if (!refs.has(ref.toString())) { doc.context.delete(ref); continue; }
    if (value instanceof PDFRawStream && !value.dict.has(PDFName.of("Filter")) && !value.dict.has(PDFName.of("DecodeParms"))) {
      const encoded = deflateSync(value.contents);
      if (encoded.length < value.contents.length) {
        const dict = value.dict.clone();
        dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
        dict.set(PDFName.of("Length"), doc.context.obj(encoded.length));
        doc.context.assign(ref, PDFRawStream.of(dict, encoded));
      }
    }
  }
}

function removeMetadata(doc: PDFDocument) {
  delete doc.context.trailerInfo.Info;
  doc.catalog.delete(PDFName.of("Metadata"));
  for (const [, value] of doc.context.enumerateIndirectObjects()) {
    const dict = value instanceof PDFStream ? value.dict : value instanceof PDFDict ? value : undefined;
    dict?.delete(PDFName.of("Metadata"));
  }
}

function removeExtras(doc: PDFDocument) {
  doc.catalog.delete(PDFName.of("Outlines"));
  doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict)?.delete(PDFName.of("EmbeddedFiles"));
  for (const [, value] of doc.context.enumerateIndirectObjects()) {
    if (!(value instanceof PDFDict)) continue;
    value.delete(PDFName.of("AF"));
    const annotations = value.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annotations) continue;
    for (let i = annotations.size() - 1; i >= 0; i--) {
      const annotation = doc.context.lookup(annotations.get(i));
      if (annotation instanceof PDFDict && annotation.get(PDFName.of("Subtype")) === PDFName.of("FileAttachment")) annotations.remove(i);
    }
  }
}

export async function processRequest(request: Request): Promise<Report | Uint8Array> {
  const source = await load(request.bytes);
  if (request.kind === "inspect") return {
    pages: source.getPageCount(), forms: source.getForm().getFields().length,
    signatures: source.context.enumerateIndirectObjects().some(([, v]) => v instanceof PDFDict && (v.get(PDFName.of("Type")) === PDFName.of("Sig") || v.get(PDFName.of("FT")) === PDFName.of("Sig"))),
  };
  const options = request.options;
  validateOptions(options);
  let output = source;
  if (options.mode === "raster") {
    if (!request.pages || request.pages.length !== source.getPageCount()) throw new Error("error.pages");
    output = await PDFDocument.create({ updateMetadata: false });
    if (!options.removeMetadata) {
      const copy = PDFObjectCopier.for(source.context, output.context);
      const info = source.context.trailerInfo.Info;
      if (info) output.context.trailerInfo.Info = copy.copy(info);
      const metadata = source.catalog.get(PDFName.of("Metadata"));
      if (metadata) output.catalog.set(PDFName.of("Metadata"), copy.copy(metadata));
    }
    let total = 0;
    for (const item of request.pages) {
      if (!(item.bytes instanceof Uint8Array) || (total += item.bytes.length) > MAX_FILE_BYTES ||
        ![item.width, item.height].every(n => Number.isInteger(n) && n > 0 && n <= 16384) || item.width * item.height > MAX_PIXELS ||
        ![item.pointsWidth, item.pointsHeight].every(n => Number.isFinite(n) && n > 0)) throw new Error("error.dimensions");
      const page = output.addPage([item.pointsWidth, item.pointsHeight]);
      if (item.mono) {
        if (item.bytes.length !== Math.ceil(item.width / 8) * item.height) throw new Error("error.dimensions");
        const stream = output.context.flateStream(item.bytes, { Type: "XObject", Subtype: "Image", Width: item.width, Height: item.height, ColorSpace: "DeviceGray", BitsPerComponent: 1 });
        const key = page.node.newXObject("Image", output.context.register(stream));
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(item.pointsWidth, 0, 0, item.pointsHeight, 0, 0), drawObject(key), popGraphicsState());
      } else {
        const image = await output.embedJpg(item.bytes);
        page.drawImage(image, { x: 0, y: 0, width: item.pointsWidth, height: item.pointsHeight });
      }
    }
  } else if (options.flattenForms) {
    try { source.getForm().flatten({ updateFieldAppearances: false }); }
    catch { throw new Error("error.forms"); }
    for (const page of source.getPages()) {
      const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annotations) continue;
      for (let i = annotations.size() - 1; i >= 0; i--) {
        const value = source.context.lookup(annotations.get(i));
        if (!value || (value instanceof PDFDict && value.get(PDFName.of("Subtype")) === PDFName.of("Widget"))) annotations.remove(i);
      }
    }
    source.catalog.delete(PDFName.of("AcroForm"));
  }
  if (options.removeMetadata) removeMetadata(output);
  if (options.removeExtras) removeExtras(output);
  compact(output);
  const bytes = await output.save({ useObjectStreams: true, updateFieldAppearances: false });
  if (bytes.length > MAX_FILE_BYTES) throw new Error("error.outputSize");
  return bytes;
}
