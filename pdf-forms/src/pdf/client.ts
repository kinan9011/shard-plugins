import { spawnWorker } from "../shard-sdk";
import type { Request } from "./engine";
import { FormError } from "./errors";
export function runEngine<T>(request: Request, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined, finished = false;
    const finish = (error?: Error, result?: T) => {
      if (finished) return; finished = true;
      worker?.terminate(); clearTimeout(timer); signal.removeEventListener("abort", cancel);
      if (error) reject(error); else resolve(result!);
    };
    const cancel = () => finish(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new FormError("error.timeout")), request.kind === "batch" ? 180_000 : 60_000);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    void spawnWorker("./pdf-engine.js").then(created => {
      if (finished) { created.terminate(); return; }
      worker = created;
      worker.onmessage = ({ data }) => finish(data.error ? new FormError(data.error.key, data.error.vars) : undefined, data.result);
      worker.onerror = event => { event.preventDefault(); finish(new FormError("error.worker")); };
      worker.onmessageerror = () => finish(new FormError("error.worker"));
      worker.postMessage(request);
    }).catch(() => finish(new FormError("error.worker")));
  });
}
