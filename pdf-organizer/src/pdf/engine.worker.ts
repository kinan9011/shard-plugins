import { exportDocument, importDocument, type Request } from "./engine";

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    const result = data.kind === "import" ? await importDocument(data.bytes) : await exportDocument(data.sources, data.pages, data.groups);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "PDF processing failed." });
  }
};
