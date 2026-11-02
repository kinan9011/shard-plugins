// Shard plugin SDK v1. Request/response over postMessage with ids, a version tag and timeouts.
// Zero dependencies. The host side is src/plugins/bridge.ts in the app.

export const PROTOCOL_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 15_000;

export type ToastKind = "info" | "success" | "warning" | "error";

export interface Theme {
  isDark: boolean;
  /** The color scheme id, e.g. "default" or "solarized". */
  scheme: string;
  /** CSS custom properties of the app, e.g. "--background": "220 23% 98%". Apply them to `:root`. */
  vars: Record<string, string>;
}

export interface ReadyInfo {
  pluginId: string;
  theme: Theme;
  /** Whether the plugin's tab is on screen right now. */
  visible: boolean;
}

export interface ConnectOptions {
  /** How long a call may take before it rejects. Default 15 s. */
  timeoutMs?: number;
  /** The window that answers. Default `window.parent`. */
  target?: Window;
  /** The window that receives the answers. Default `window`. */
  self?: Window;
}

export type SdkErrorCode = "bad_request" | "unknown_method" | "timeout" | "failed" | "permission_denied";

/** A call the host refused or could not complete. */
export class SdkError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SdkError";
    this.code = code;
  }
}

/** A call that needs a permission the user has not granted this plugin. `permission` names it, e.g. "clipboard:write". */
export class PermissionError extends SdkError {
  permission: string;
  constructor(message: string, permission: string) {
    super("permission_denied", message);
    this.name = "PermissionError";
    this.permission = permission;
  }
}

export interface FetchInit {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  /** A text body. */
  body?: string;
}

export interface FetchResponse {
  status: number;
  /** True for a status from 200 to 299. */
  ok: boolean;
  statusText: string;
  /** Header names are lowercase. Repeated headers are joined with ", ". */
  headers: Record<string, string>;
  /** The URL after redirects. */
  url: string;
  body: Uint8Array;
  text(): string;
  json<T = unknown>(): T;
}

export interface OpenOptions {
  /** File extensions for the dialog filter, e.g. `["json", "txt"]`. */
  accept?: string[];
}

export interface ShardSdk {
  /** Handshake. Resolves with the plugin id and the current theme. Call it first. */
  ready(): Promise<ReadyInfo>;
  theme: {
    get(): Promise<Theme>;
    /** Calls `callback` whenever the app theme or color scheme changes. Returns an unsubscribe function. */
    onChange(callback: (theme: Theme) => void): () => void;
  };
  /**
   * Calls `callback(true)` when the plugin's tab is shown and `callback(false)` when another tab covers it.
   * A hidden plugin should pause timers and animations. Returns an unsubscribe function.
   */
  onVisibilityChange(callback: (visible: boolean) => void): () => void;
  /** Shows a notification in the app. */
  toast(message: string, kind?: ToastKind): Promise<void>;
  /** Needs `clipboard:read` / `clipboard:write`. */
  clipboard: {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
  };
  /** Needs `files:open` / `files:save`. The user picks the file in a dialog the app shows. */
  files: {
    /** Resolves to `null` when the user cancels. Files over 50 MB reject. */
    open(options?: OpenOptions & { as?: "text" }): Promise<{ name: string; size: number; text: string } | null>;
    open(options: OpenOptions & { as: "bytes" }): Promise<{ name: string; size: number; bytes: Uint8Array } | null>;
    /** Resolves to `false` when the user cancels the save dialog. `name` is the suggested file name. */
    save(name: string, data: string | Uint8Array | ArrayBuffer): Promise<boolean>;
  };
  /** Needs `network`. The app makes the request, and only to hosts the plugin declares or the user added. */
  net: {
    fetch(url: string, init?: FetchInit): Promise<FetchResponse>;
  };
  /** A small per-plugin key-value store (JSON values except null, 1 MB in total). */
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

/**
 * Loads and instantiates a `.wasm` file of the plugin package. `path` is relative to the page.
 * Streams the module when the webview can, and otherwise reads the bytes first.
 */
export async function loadWasm(path: string, imports: WebAssembly.Imports = {}): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
  const url = new URL(path, location.href).href;
  if (typeof WebAssembly.instantiateStreaming === "function") {
    try {
      return await WebAssembly.instantiateStreaming(fetch(url), imports);
    } catch (error) {
      // A wrong MIME type or a webview that cannot stream is a TypeError: read the bytes instead.
      // A bad module (CompileError, LinkError) would fail the same way again, so it is passed on.
      if (!(error instanceof TypeError)) throw error;
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new SdkError("failed", `Could not load ${path}: ${response.status} ${response.statusText}`.trim());
  return WebAssembly.instantiate(await response.arrayBuffer(), imports);
}

/**
 * Starts a Web Worker from a script of the plugin package. `path` is relative to the page.
 * The plugin's frame has an opaque origin, and a browser starts a worker only from a script of the
 * page's own origin, so the script is read and started from a Blob URL. Such a worker's own
 * location is `blob:`: give it absolute URLs, or send it a compiled `WebAssembly.Module` with `postMessage`.
 */
export async function spawnWorker(path: string, options?: WorkerOptions): Promise<Worker> {
  const response = await fetch(new URL(path, location.href).href);
  if (!response.ok) throw new SdkError("failed", `Could not load ${path}: ${response.status} ${response.statusText}`.trim());
  const blob = new Blob([await response.arrayBuffer()], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    return new Worker(url, options);
  } finally {
    // The worker has resolved the URL by now.
    URL.revokeObjectURL(url);
  }
}

export function connect(options: ConnectOptions = {}): ShardSdk {
  const self = options.self ?? window;
  const target = options.target ?? window.parent;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = new Map<string, Pending>();
  const listeners = new Set<(theme: Theme) => void>();
  const visibilityListeners = new Set<(visible: boolean) => void>();

  // An uncaught error tells the host, which then offers Reload and Disable. Without the handshake the host does the same after 10 s.
  self.addEventListener("error", (event: ErrorEvent) => {
    target.postMessage({ v: PROTOCOL_VERSION, event: "error", message: String(event.message || event.error || "Unknown error").slice(0, 500) }, "*");
  });

  self.addEventListener("message", (event: MessageEvent) => {
    // Only the host answers. Another frame or window cannot spoof a response.
    if (event.source !== target) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.v !== PROTOCOL_VERSION) return;
    if (data.event === "theme") {
      for (const listener of [...listeners]) {
        // One failing callback must not keep the others from the update.
        try {
          listener(data.data as Theme);
        } catch (error) {
          console.error(error);
        }
      }
      return;
    }
    if (data.event === "visibility") {
      for (const listener of [...visibilityListeners]) {
        try {
          listener(Boolean(data.data?.visible));
        } catch (error) {
          console.error(error);
        }
      }
      return;
    }
    if (typeof data.id !== "string") return;
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    if (call.timer !== undefined) clearTimeout(call.timer);
    if (data.error) {
      const { code, message, permission } = data.error;
      call.reject(code === "permission_denied" ? new PermissionError(String(message), String(permission)) : new SdkError(String(code), String(message)));
    }
    else call.resolve(data.result);
  });

  /** `limit`: how long this call may take. `null` waits for as long as it takes (a dialog the user has to answer). */
  function call<T>(method: string, params?: Record<string, unknown>, limit: number | null = timeoutMs): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = nextId();
      const timer =
        limit === null
          ? undefined
          : setTimeout(() => {
              pending.delete(id);
              reject(new SdkError("timeout", `timeout: ${method}`));
            }, limit);
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      // "*" because this frame and the host have different origins (the frame's is opaque).
      target.postMessage({ v: PROTOCOL_VERSION, id, method, params }, "*");
    });
  }

  return {
    ready: () => call<ReadyInfo>("ready"),
    theme: {
      get: () => call<Theme>("theme.get"),
      onChange(callback) {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    },
    onVisibilityChange(callback) {
      visibilityListeners.add(callback);
      return () => {
        visibilityListeners.delete(callback);
      };
    },
    toast: (message, kind = "info") => call<void>("toast", { message, kind }),
    clipboard: {
      readText: () => call<string>("clipboard.readText"),
      writeText: (text) => call<void>("clipboard.writeText", { text }),
    },
    files: {
      open: ((options: OpenOptions & { as?: "text" | "bytes" } = {}) => call("files.open", { accept: options.accept, as: options.as ?? "text" }, null)) as ShardSdk["files"]["open"],
      save: (name, data) => call<boolean>("files.save", { name, data }, null),
    },
    net: {
      async fetch(url, init) {
        // The app allows its own 30 s for the request, so wait a little longer than that, whatever `timeoutMs` is.
        const raw = await call<Omit<FetchResponse, "ok" | "text" | "json">>("net.fetch", { url, init }, Math.max(timeoutMs, 40_000));
        return {
          ...raw,
          ok: raw.status >= 200 && raw.status < 300,
          text: () => new TextDecoder().decode(raw.body),
          json: <T = unknown>() => JSON.parse(new TextDecoder().decode(raw.body)) as T,
        };
      },
    },
    storage: {
      async get<T = unknown>(key: string) {
        return (await call<T | null>("storage.get", { key })) ?? null;
      },
      set(key, value) {
        if (value === undefined || value === null) return Promise.reject(new TypeError("storage.set needs a value other than null. Use storage.remove to delete a key."));
        return call<void>("storage.set", { key, value });
      },
      remove: (key) => call<void>("storage.remove", { key }),
    },
  };
}
