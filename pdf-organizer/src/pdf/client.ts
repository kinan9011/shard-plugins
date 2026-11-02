import { spawnWorker } from "../shard-sdk";
import type { ImportResult, Request } from "./engine";
import { checkImageSize, imageSize, inputKind } from "./limits";

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
    const cancel = () => finish(new DOMException("Processing cancelled.", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Processing exceeded 60 seconds. Try a smaller document.")), 60_000);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    void spawnWorker("./pdf-engine.js").then(created => {
      if (finished) { created.terminate(); return; }
      worker = created;
      worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : undefined, data.result);
      worker.onerror = event => { event.preventDefault(); finish(new Error("The PDF worker failed. Try a smaller or different document.")); };
      worker.onmessageerror = () => finish(new Error("Could not read the PDF worker response."));
      worker.postMessage(request);
    }).catch(error => finish(error));
  });
}

/** Browser decoding honors JPEG orientation before embedding the image at 96 dpi. */
export async function prepareInput(bytes: Uint8Array, signal: AbortSignal) {
  const kind = inputKind(bytes);
  if (kind === "pdf") return runEngine<ImportResult>({ kind: "import", bytes }, signal);
  imageSize(bytes, kind);
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
  try {
    checkImageSize(bitmap.width, bitmap.height);
    if (signal.aborted) throw new DOMException("Processing cancelled.", "AbortError");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image decoding is unavailable.");
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not read this image.")), "image/png"));
    canvas.width = canvas.height = 0;
    return await runEngine<ImportResult>({ kind: "import", bytes: new Uint8Array(await png.arrayBuffer()) }, signal);
  } finally { bitmap.close(); }
}
