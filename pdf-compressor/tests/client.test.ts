import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist";
import { spawnWorker } from "../src/shard-sdk";
import { compress, runEngine } from "../src/pdf/client";
import { DEFAULT_OPTIONS } from "../src/pdf/options";

vi.mock("../src/shard-sdk", () => ({ spawnWorker: vi.fn() }));
vi.mock("pdfjs-dist", () => ({ AnnotationMode: { ENABLE: 1 }, GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
describe("PDF worker lifecycle", () => {
  it("cancels even before the rendering worker has started, then terminates a late worker", async () => {
    const controller = new AbortController();
    let started!: (worker: Worker) => void;
    vi.mocked(spawnWorker).mockReturnValue(new Promise(resolve => { started = resolve; }));
    const result = compress(new Uint8Array(10), { ...DEFAULT_OPTIONS, mode: "raster" }, controller.signal, vi.fn());
    controller.abort();
    await expect(result).rejects.toHaveProperty("name", "AbortError");
    const worker = { terminate: vi.fn() } as unknown as Worker;
    started(worker); await Promise.resolve();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(getDocument).not.toHaveBeenCalled();
  });
  it("cancels a pending PDF load without waiting for PDF.js destroy", async () => {
    const controller = new AbortController();
    const worker = { terminate: vi.fn() } as unknown as Worker;
    vi.mocked(spawnWorker).mockResolvedValue(worker);
    const destroy = vi.fn(() => new Promise<void>(() => {}));
    vi.mocked(getDocument).mockReturnValue({ promise: new Promise(() => {}), destroy } as never);
    const result = compress(new Uint8Array(10), { ...DEFAULT_OPTIONS, mode: "raster" }, controller.signal, vi.fn());
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledOnce());
    controller.abort();
    await expect(result).rejects.toHaveProperty("name", "AbortError");
    expect(destroy).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("cancels an engine job and terminates its worker", async () => {
    const controller = new AbortController();
    const worker = { terminate: vi.fn(), postMessage: vi.fn() } as unknown as Worker;
    vi.mocked(spawnWorker).mockResolvedValue(worker);
    const result = runEngine({ kind: "inspect", bytes: new Uint8Array(10) }, controller.signal);
    await Promise.resolve(); controller.abort();
    await expect(result).rejects.toHaveProperty("name", "AbortError");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
