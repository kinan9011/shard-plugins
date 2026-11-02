import { processPixels, type ProcessOptions } from "./image-process";
import { provideWasm } from "./wasm-source";

interface ProcessRequest {
  id: number;
  options: ProcessOptions;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** Codec files the page fetched for this request. This worker has no base URL to fetch them itself. */
  wasm?: Record<string, ArrayBuffer>;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<ProcessRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async (event: MessageEvent<ProcessRequest>) => {
  const { id, options, width, height, data, wasm } = event.data;
  try {
    if (wasm) provideWasm(wasm);
    const result = await processPixels({ data, width, height }, options);
    scope.postMessage({ id, result }, [result.bytes.buffer]);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : "Encoding failed." });
  }
};
