import { CodedError } from "./errors";
import { blankDocument, exportDocument, importDocument, mergePages, type Request } from "./engine";

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    const result = data.kind === "import" ? await importDocument(data.bytes)
      : data.kind === "blank" ? await blankDocument(data.width, data.height)
      : data.kind === "merge" ? await mergePages(data.sources, data.pages, data)
      : await exportDocument(data.sources, data.pages, data.groups, data.metadata);
    self.postMessage({ result });
  } catch (error) {
    const coded = error instanceof CodedError ? error : error instanceof Error ? undefined : new CodedError("engine.failed");
    self.postMessage({ error: coded?.message ?? (error as Error).message, key: coded?.key, vars: coded?.vars });
  }
};
