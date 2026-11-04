import { processRequest, type Request } from "./engine";

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    const result = await processRequest(data);
    self.postMessage({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "error.pdf";
    self.postMessage({ error: message.startsWith("error.") ? message : "error.pdf" });
  }
};
