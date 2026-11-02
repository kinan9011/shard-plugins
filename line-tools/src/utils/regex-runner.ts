import { spawnWorker } from "@/shard-sdk";
import { runRegex, type RegexRequest, type RegexResult } from "./regex";

/** A run that takes longer than this is stopped, so a runaway pattern cannot freeze the tool. */
export const REGEX_TIMEOUT_MS = 2000;

export const TIMEOUT_ERROR = `The pattern ran for more than ${REGEX_TIMEOUT_MS / 1000} seconds and was stopped. Nested quantifiers such as (a+)+ can backtrack without end. Make the pattern more specific.`;

// Plugin version of the app's regex-runner: the frame's opaque origin cannot start `new Worker(new URL(...))`,
// so the bundled public/regex-worker.js is started with the SDK's spawnWorker().
const WORKER_PATH = "regex-worker.js";

interface ActiveRun {
  id: number;
  request: RegexRequest;
  finish: (result: RegexResult | null) => void;
}

let worker: Promise<Worker | null> | null = null;
let workerFailed = false;
let nextId = 0;
let active: ActiveRun | null = null;

const stopWorker = () => {
  const old = worker;
  worker = null;
  void old?.then((w) => w?.terminate());
};

const getWorker = (): Promise<Worker | null> => {
  if (workerFailed || typeof Worker === "undefined") return Promise.resolve(null);
  if (!worker) {
    const started: Promise<Worker | null> = spawnWorker(WORKER_PATH, { type: "classic" }).then(
      (w) => {
        w.onmessage = (event: MessageEvent<{ id: number; result: RegexResult }>) => {
          if (active?.id === event.data.id) active.finish(event.data.result);
        };
        w.onerror = () => {
          // The worker cannot run here, so this run and later runs use the main thread.
          workerFailed = true;
          stopWorker();
          active?.finish(runRegex(active.request));
        };
        return w;
      },
      () => {
        workerFailed = true;
        return null;
      },
    );
    worker = started;
  }
  return worker;
};

/**
 * Runs the regex in a worker and stops it after REGEX_TIMEOUT_MS. A new run cancels the
 * run before it, which then resolves to null. Without worker support, it runs on the main thread.
 */
export function runRegexInWorker(request: RegexRequest): Promise<RegexResult | null> {
  if (active) {
    // The worker is still busy with input the user has already changed.
    stopWorker();
    active.finish(null);
  }
  const id = ++nextId;
  return new Promise((resolve) => {
    const finish = (result: RegexResult | null) => {
      clearTimeout(timer);
      if (active?.id === id) active = null;
      resolve(result);
    };
    const timer = setTimeout(() => {
      stopWorker();
      finish({ ok: false, error: TIMEOUT_ERROR });
    }, REGEX_TIMEOUT_MS);
    active = { id, request, finish };
    void getWorker().then((target) => {
      if (active?.id !== id) return; // cancelled or timed out while the worker started
      if (!target) finish(runRegex(request));
      else target.postMessage({ id, request });
    });
  });
}
