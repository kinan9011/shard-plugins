import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom 20 predates AbortSignal.throwIfAborted, available in the host webview.
if (!AbortSignal.prototype.throwIfAborted) AbortSignal.prototype.throwIfAborted = function () {
  if (this.aborted) throw new DOMException("Cancelled", "AbortError");
};
