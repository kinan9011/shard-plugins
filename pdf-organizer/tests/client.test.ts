import { afterEach, describe, expect, it, vi } from "vitest";
import { runEngine } from "../src/pdf/client";
import { spawnWorker } from "../src/shard-sdk";

vi.mock("../src/shard-sdk", () => ({ spawnWorker: vi.fn() }));
afterEach(() => vi.useRealTimers());
const request = { kind: "import" as const, bytes: new Uint8Array([37, 80, 68, 70]) };

describe("cancellable PDF worker", () => {
  it("terminates after success and forwards the result", async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: undefined as unknown };
    vi.mocked(spawnWorker).mockResolvedValue(worker as unknown as Worker);
    const result = runEngine(request, new AbortController().signal);
    await Promise.resolve();
    (worker.onmessage as (event: unknown) => void)({ data: { result: { count: 3 } } });
    await expect(result).resolves.toEqual({ count: 3 });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates on cancellation and cleans up late-starting workers", async () => {
    const controller = new AbortController();
    const worker = { terminate: vi.fn() };
    let resolve!: (worker: Worker) => void;
    vi.mocked(spawnWorker).mockReturnValue(new Promise(done => { resolve = done; }));
    const result = runEngine(request, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    resolve(worker as unknown as Worker);
    await Promise.resolve();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("stops an unresponsive worker at the timeout", async () => {
    vi.useFakeTimers();
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    vi.mocked(spawnWorker).mockResolvedValue(worker as unknown as Worker);
    const result = runEngine(request, new AbortController().signal);
    const rejection = expect(result).rejects.toThrow("60 seconds");
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
