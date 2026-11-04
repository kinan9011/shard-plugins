import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from "pdfjs-dist";
import { spawnWorker } from "../shard-sdk";
import { CodedError } from "./errors";
import type { Page, Source } from "./engine";
import type { Crop } from "./geometry";

let port: Promise<Worker> | undefined;
const documents = new Map<string, PDFDocumentLoadingTask>();

export async function previewDocument(source: Source) {
  port ??= spawnWorker("./pdf-preview.js").then(worker => {
    worker.onerror = event => { event.preventDefault(); if (port === pendingPort) clearPreviews(); };
    return worker;
  }).catch(error => { if (port === pendingPort) port = undefined; throw error; });
  const pendingPort = port;
  const worker = await pendingPort;
  if (port !== pendingPort) throw new CodedError("preview.cancelled");
  GlobalWorkerOptions.workerPort = worker;
  let task = documents.get(source.id);
  if (!task) {
    task = getDocument({
      data: source.bytes.slice(),
      isEvalSupported: false,
      useWasm: false,
      isImageDecoderSupported: false,
      useWorkerFetch: false,
      cMapUrl: new URL("./pdf-assets/cmaps/", location.href).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./pdf-assets/standard_fonts/", location.href).href,
    });
    documents.set(source.id, task);
  }
  return task.promise;
}

export function clearPreviews() {
  for (const task of documents.values()) void task.destroy().catch(() => {});
  documents.clear();
  const previous = port;
  port = undefined;
  GlobalWorkerOptions.workerPort = null;
  void previous?.then(worker => worker.terminate()).catch(() => {});
}

/** Displayed size of a page in points (rotation applied, crop ignored). */
export async function pageSize(source: Source, page: Page): Promise<[number, number]> {
  const pdfPage = await (await previewDocument(source)).getPage(page.index + 1);
  const view = pdfPage.getViewport({ scale: 1, rotation: pdfPage.rotate + page.rotation });
  return [view.width, view.height];
}

/** Bounding box of everything that is not white, as margins [left, top, right, bottom] of the displayed page; null for a blank page. */
export async function contentBounds(source: Source, page: Page): Promise<Crop | null> {
  const pdfPage = await (await previewDocument(source)).getPage(page.index + 1);
  const rotation = pdfPage.rotate + page.rotation;
  const natural = pdfPage.getViewport({ scale: 1, rotation });
  const viewport = pdfPage.getViewport({ scale: Math.min(400 / natural.width, 400 / natural.height), rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
  try {
    await pdfPage.render({ canvas, viewport }).promise;
    const { data, width, height } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (data[at + 3] > 8 && (data[at] < 245 || data[at + 1] < 245 || data[at + 2] < 245)) {
        if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
      }
    }
    if (right < 0) return null;
    // One pixel of breathing room so anti-aliased edges are not clipped.
    return [Math.max(0, left - 1) / width, Math.max(0, top - 1) / height, Math.max(0, width - right - 2) / width, Math.max(0, height - bottom - 2) / height];
  } finally { canvas.width = canvas.height = 0; }
}
