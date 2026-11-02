import { sdk } from "./sdk";

// A plugin frame has an opaque origin (sandbox without allow-same-origin), so `window.localStorage` throws.
// Tools written for the app use it for their settings, so this puts a Storage in its place: it lives in memory,
// is loaded once at start from the plugin's SDK storage, and is written back (one key, JSON) after changes.
// The SDK store holds 1 MB per plugin, which is plenty for settings; a tool that saves big inputs must not use it.
const KEY = "localStorage";
const WRITE_DELAY_MS = 300;
const LOAD_TIMEOUT_MS = 2000; // without a host (npm run dev) nobody answers

function createStorage(initial: Record<string, string>, persist: (entries: Record<string, string>) => void): Storage {
  const entries = new Map(Object.entries(initial));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => persist(Object.fromEntries(entries)), WRITE_DELAY_MS);
  };
  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
      changed();
    },
    getItem: (key) => entries.get(String(key)) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem(key) {
      if (entries.delete(String(key))) changed();
    },
    setItem(key, value) {
      entries.set(String(key), String(value));
      changed();
    },
  };
}

/** Call before the tool renders. A failure leaves the tool with an empty, in-memory storage. */
export async function installLocalStorage(): Promise<void> {
  let initial: Record<string, string> = {};
  try {
    const saved = await Promise.race([sdk.storage.get(KEY), new Promise<null>((resolve) => setTimeout(() => resolve(null), LOAD_TIMEOUT_MS))]);
    if (saved && typeof saved === "object") initial = saved as Record<string, string>;
  } catch {
    // The host refused: start empty.
  }
  const storage = createStorage(initial, (entries) => void sdk.storage.set(KEY, entries).catch(() => {}));
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
}
