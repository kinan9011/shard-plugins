// Vitest setup for ported tools. The tools were written for the app, so this gives them what the app's tests/setup.ts does,
// and answers the plugin SDK with the same mocks: sdk.clipboard.* goes to navigator.clipboard, which tests spy on.
import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

vi.mock("@/sdk", () => ({
  sdk: {
    clipboard: { writeText: (text: string) => navigator.clipboard.writeText(text), readText: () => navigator.clipboard.readText() },
    files: { save: vi.fn(async () => true), open: vi.fn(async () => null) },
    storage: { get: vi.fn(async () => null), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    toast: vi.fn(async () => {}),
    onVisibilityChange: () => () => {},
  },
}));

// Lazy-loaded tools can take well over the 1s default under full-suite load
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());

Object.defineProperty(global.navigator, "clipboard", {
  value: { writeText: vi.fn(() => Promise.resolve()), readText: vi.fn(() => Promise.resolve("")) },
  writable: true,
});
Object.defineProperty(global.URL, "createObjectURL", { value: vi.fn(() => "blob:mock-url"), writable: true });
Object.defineProperty(global.URL, "revokeObjectURL", { value: vi.fn(), writable: true });

// jsdom has no layout: text measurement and size observers are stubbed.
if (typeof Range !== "undefined") {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom has no modal <dialog>; model just enough of it for components that call showModal()/close().
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
}
