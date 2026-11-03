import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { spawnWorker } from "../src/shard-sdk";
import { clearPreviews, previewDocument } from "../src/pdf/preview";
import type { Source } from "../src/pdf/engine";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerPort: null } }));
vi.mock("../src/shard-sdk", () => ({ spawnWorker: vi.fn() }));
const source: Source = { id: "source", name: "sample.pdf", bytes: new Uint8Array([1, 2]), count: 1, report: { forms: 0, annotations: 0, signatures: false, outlines: false } };

beforeEach(() => vi.clearAllMocks());
afterEach(async () => { clearPreviews(); await Promise.resolve(); });

it("shares source documents between grid and selected previews and destroys them on clear", async () => {
  const worker = { terminate: vi.fn() } as unknown as Worker;
  const document = { getPage: vi.fn() };
  const task = { promise: Promise.resolve(document), destroy: vi.fn(async () => {}) };
  vi.mocked(spawnWorker).mockResolvedValue(worker);
  vi.mocked(getDocument).mockReturnValue(task as never);
  expect(await previewDocument(source)).toBe(document);
  expect(await previewDocument(source)).toBe(document);
  expect(getDocument).toHaveBeenCalledOnce(); expect(spawnWorker).toHaveBeenCalledOnce();
  expect(GlobalWorkerOptions.workerPort).toBe(worker);
  clearPreviews(); await Promise.resolve();
  expect(task.destroy).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce();
  expect(GlobalWorkerOptions.workerPort).toBeNull();
});

it("does not recreate a document after the session is cleared during worker startup", async () => {
  let complete!: (worker: Worker) => void;
  const worker = { terminate: vi.fn() } as unknown as Worker;
  vi.mocked(spawnWorker).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const pending = previewDocument(source);
  clearPreviews(); complete(worker);
  await expect(pending).rejects.toThrow("Preview cancelled.");
  expect(getDocument).not.toHaveBeenCalled(); expect(worker.terminate).toHaveBeenCalledOnce();
  expect(GlobalWorkerOptions.workerPort).toBeNull();
});

it("keeps the current worker when an obsolete startup fails after a session reset", async () => {
  let fail!: (error: Error) => void;
  const worker = { terminate: vi.fn() } as unknown as Worker;
  const document = { getPage: vi.fn() };
  const task = { promise: Promise.resolve(document), destroy: vi.fn(async () => {}) };
  vi.mocked(spawnWorker).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValue(worker);
  vi.mocked(getDocument).mockReturnValue(task as never);
  const obsolete = previewDocument(source);
  clearPreviews();
  expect(await previewDocument(source)).toBe(document);
  fail(new Error("Old worker failed"));
  await expect(obsolete).rejects.toThrow("Old worker failed");
  expect(await previewDocument(source)).toBe(document);
  expect(spawnWorker).toHaveBeenCalledTimes(2);
  expect(getDocument).toHaveBeenCalledOnce();
  expect(worker.terminate).not.toHaveBeenCalled();
  expect(GlobalWorkerOptions.workerPort).toBe(worker);
});

it("ignores obsolete worker errors but clears previews when the current worker fails", async () => {
  const previous = { terminate: vi.fn() } as unknown as Worker;
  const current = { terminate: vi.fn() } as unknown as Worker;
  const task = { promise: Promise.resolve({ getPage: vi.fn() }), destroy: vi.fn(async () => {}) };
  vi.mocked(spawnWorker).mockResolvedValueOnce(previous).mockResolvedValueOnce(current);
  vi.mocked(getDocument).mockReturnValue(task as never);
  await previewDocument(source);
  clearPreviews();
  await previewDocument(source);
  task.destroy.mockClear();
  const event = { preventDefault: vi.fn() } as unknown as ErrorEvent;
  previous.onerror!(event);
  expect(task.destroy).not.toHaveBeenCalled();
  expect(GlobalWorkerOptions.workerPort).toBe(current);
  current.onerror!(event);
  await Promise.resolve();
  expect(task.destroy).toHaveBeenCalledOnce();
  expect(current.terminate).toHaveBeenCalledOnce();
  expect(GlobalWorkerOptions.workerPort).toBeNull();
});
