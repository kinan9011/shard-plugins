import { afterEach, expect, it, vi } from "vitest";
import { spawnWorker } from "../src/shard-sdk";
import { runEngine } from "../src/pdf/client";
vi.mock("../src/shard-sdk", () => ({ spawnWorker: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
const request = { kind: "inspect" as const, bytes: new Uint8Array([1]) };
const worker = () => ({ terminate: vi.fn(), postMessage: vi.fn(), onmessage: null as ((event: { data: unknown }) => void) | null, onerror: null as ((event: { preventDefault: () => void }) => void) | null });

it("terminates a worker after a successful result", async () => {
  const w = worker(); vi.mocked(spawnWorker).mockResolvedValue(w as unknown as Worker);
  const result = runEngine(request, new AbortController().signal); await Promise.resolve();
  w.onmessage!({ data: { result: { pages: 2 } } });
  await expect(result).resolves.toEqual({ pages: 2 }); expect(w.terminate).toHaveBeenCalledOnce();
});
it("cancels before asynchronous worker startup without leaking the late worker", async () => {
  let start!: (value: Worker) => void;
  vi.mocked(spawnWorker).mockReturnValue(new Promise(resolve => { start = resolve; }));
  const controller = new AbortController(), result = runEngine(request, controller.signal);
  controller.abort(); await expect(result).rejects.toMatchObject({ name: "AbortError" });
  const w = worker(); start(w as unknown as Worker); await Promise.resolve();
  expect(w.terminate).toHaveBeenCalledOnce(); expect(w.postMessage).not.toHaveBeenCalled();
});
it("ends failed and timed-out workers with recoverable errors", async () => {
  vi.useFakeTimers(); const w = worker(); vi.mocked(spawnWorker).mockResolvedValue(w as unknown as Worker);
  const result = runEngine(request, new AbortController().signal);
  const rejected = expect(result).rejects.toMatchObject({ key: "error.timeout" });
  await vi.advanceTimersByTimeAsync(60_000); await rejected;
  expect(w.terminate).toHaveBeenCalledOnce();
  vi.mocked(spawnWorker).mockRejectedValue(new Error("failed to fetch"));
  await expect(runEngine(request, new AbortController().signal)).rejects.toMatchObject({ key: "error.worker" });
});
