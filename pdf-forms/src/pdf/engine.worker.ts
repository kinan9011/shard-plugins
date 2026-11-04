import { execute, type Request } from "./engine";
import { FormError } from "./errors";
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try { self.postMessage({ result: await execute(data) }); }
  catch (error) { self.postMessage({ error: error instanceof FormError ? { key: error.key, vars: error.vars } : { key: "error.processing", vars: {} } }); }
};
