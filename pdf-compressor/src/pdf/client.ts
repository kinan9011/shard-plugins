import { AnnotationMode, getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "pdfjs-dist";
import { spawnWorker } from "../shard-sdk";
import { MAX_FILE_BYTES, monochrome, rasterSize, validateOptions, type Options } from "./options";
import type { RasterPage, Request } from "./engine";

export function runEngine<T>(request: Request, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let finished = false;
    const finish = (error?: Error, result?: T) => {
      if (finished) return;
      finished = true;
      worker?.terminate();
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (error) reject(error); else resolve(result!);
    };
    const cancel = () => finish(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new Error("error.timeout")), 60_000);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    void spawnWorker("./pdf-engine.js").then(created => {
      if (finished) { created.terminate(); return; }
      worker = created;
      worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : undefined, data.result);
      worker.onerror = event => { event.preventDefault(); finish(new Error("error.worker")); };
      worker.onmessageerror = () => finish(new Error("error.worker"));
      worker.postMessage(request);
    }).catch(error => finish(error));
  });
}

async function withPdf<T>(bytes: Uint8Array, signal: AbortSignal, work: (pdf: PDFDocumentProxy) => Promise<T>) {
  signal.throwIfAborted();
  let worker: Worker | undefined, task: PDFDocumentLoadingTask | undefined;
  let cancel!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(new DOMException("Cancelled", "AbortError"));
  });
  signal.addEventListener("abort", cancel, { once: true });
  try {
    worker = await Promise.race([spawnWorker("./pdf-preview.js").then(created => {
      if (signal.aborted) { created.terminate(); signal.throwIfAborted(); }
      return created;
    }), aborted]);
    GlobalWorkerOptions.workerPort = worker;
    task = getDocument({
      data: bytes.slice(), isEvalSupported: false, useWasm: false, isImageDecoderSupported: false, useWorkerFetch: false,
      cMapUrl: new URL("./pdf-assets/cmaps/", location.href).href, cMapPacked: true,
      standardFontDataUrl: new URL("./pdf-assets/standard_fonts/", location.href).href,
      stopAtErrors: true,
    });
    const pdf = await Promise.race([task.promise, aborted]);
    signal.throwIfAborted();
    return await Promise.race([work(pdf), aborted]);
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    // PDF.js destroy can wait forever if cancellation interrupts worker startup.
    void task?.destroy().catch(() => {});
    worker?.terminate();
    if (GlobalWorkerOptions.workerPort === worker) GlobalWorkerOptions.workerPort = null;
  }
}

export async function compress(bytes: Uint8Array, options: Options, signal: AbortSignal, progress: (page: number, total: number) => void) {
  validateOptions(options);
  if (options.mode === "optimize") return runEngine<Uint8Array>({ kind: "compress", bytes, options }, signal);
  const pages = await withPdf(bytes, signal, async pdf => {
    const images: RasterPage[] = [];
    let total = 0;
    for (let index = 1; index <= pdf.numPages; index++) {
      signal.throwIfAborted();
      progress(index, pdf.numPages);
      const page = await pdf.getPage(index);
      const natural = page.getViewport({ scale: 1 });
      const size = rasterSize(natural.width, natural.height, options.dpi);
      const canvas = document.createElement("canvas");
      canvas.width = size.width; canvas.height = size.height;
      try {
        const context = canvas.getContext("2d", { willReadFrequently: options.color !== "color" });
        if (!context) throw new Error("error.canvas");
        const render = page.render({ canvas, viewport: page.getViewport({ scale: size.scale }), background: "rgb(255,255,255)", annotationMode: AnnotationMode.ENABLE });
        const cancel = () => render.cancel();
        signal.addEventListener("abort", cancel, { once: true });
        try { await render.promise; } finally { signal.removeEventListener("abort", cancel); }
        signal.throwIfAborted();
        let encoded: Uint8Array;
        if (options.color === "bw") {
          encoded = monochrome(context.getImageData(0, 0, size.width, size.height).data, size.width, size.height, options.threshold);
        } else {
          if (options.color === "gray") {
            const image = context.getImageData(0, 0, size.width, size.height);
            for (let i = 0; i < image.data.length; i += 4) {
              const gray = Math.round(0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2]);
              image.data[i] = image.data[i + 1] = image.data[i + 2] = gray;
            }
            context.putImageData(image, 0, 0);
          }
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("error.canvas")), "image/jpeg", options.quality / 100));
          encoded = new Uint8Array(await blob.arrayBuffer());
        }
        if ((total += encoded.length) > MAX_FILE_BYTES) throw new Error("error.outputSize");
        images.push({ bytes: encoded, width: size.width, height: size.height, pointsWidth: natural.width, pointsHeight: natural.height, mono: options.color === "bw" });
      } finally { canvas.width = canvas.height = 0; page.cleanup(); }
    }
    return images;
  });
  signal.throwIfAborted();
  return runEngine<Uint8Array>({ kind: "compress", bytes, options, pages }, signal);
}

export async function preview(bytes: Uint8Array, canvas: HTMLCanvasElement, signal: AbortSignal) {
  return withPdf(bytes, signal, async pdf => {
    const page = await pdf.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(600 / natural.width, 800 / natural.height) });
    canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
    const render = page.render({ canvas, viewport, background: "rgb(255,255,255)", annotationMode: AnnotationMode.ENABLE });
    const cancel = () => render.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try { await render.promise; } finally { signal.removeEventListener("abort", cancel); }
  });
}
