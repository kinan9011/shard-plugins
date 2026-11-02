import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from "pdfjs-dist";
import { spawnWorker } from "../shard-sdk";
import type { Source } from "./engine";

let port: Promise<Worker> | undefined;
const documents = new Map<string, PDFDocumentLoadingTask>();

export async function previewDocument(source: Source) {
  port ??= spawnWorker("./pdf-preview.js").then(worker => {
    worker.onerror = event => { event.preventDefault(); clearPreviews(); };
    return worker;
  }).catch(error => { port = undefined; throw error; });
  GlobalWorkerOptions.workerPort = await port;
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
