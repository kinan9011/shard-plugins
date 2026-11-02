import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "./CopyButton";
import type { ShardSdk } from "./shard-sdk";
import { formatBytes, HASH_TYPES, HMAC_TYPES, type Hasher, type Results } from "./hasher";

type Source = "text" | "file";

const FAQ_ITEMS = [
  {
    q: "What is the difference between MD5, SHA-1, SHA-2, SHA-3, and Keccak?",
    a: "They are different hash algorithms with different output sizes and security properties. Keccak-256 is the variant that Ethereum uses. It differs from the final SHA-3-256 standard. For new integrity checks, prefer SHA-256, SHA-512, or SHA-3 and avoid MD5 or SHA-1 for security-sensitive uses.",
  },
  {
    q: "Can I use these hashes for password storage?",
    a: "No. Fast hashes like MD5 and SHA are easy for attackers to brute-force, so passwords should be stored with a slow password hash such as bcrypt, scrypt, or Argon2.",
  },
  {
    q: "Is hashing the same as encryption?",
    a: "No. Hashing is one-way, so you cannot recover the original input from the hash, while encryption is reversible with the right key.",
  },
  {
    q: "Why do two similar inputs produce completely different hashes?",
    a: "Good hash functions have an avalanche effect, meaning a tiny input change causes a very different output. That makes hashes useful for change detection and integrity checks.",
  },
  {
    q: "What is HMAC?",
    a: "HMAC mixes a secret key into the hash. Only a party that has the key can create or check the result. Use it to sign messages and webhooks.",
  },
  {
    q: "Is my file uploaded?",
    a: "No. The file is read and hashed on your device. Nothing leaves the app.",
  },
];

const encoder = new TextEncoder();
const field = "w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const button = "h-7 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground";

export default function App({ sdk, hasher }: { sdk: ShardSdk; hasher: Hasher }) {
  const [source, setSource] = useState<Source>("text");
  const [input, setInput] = useState("");
  const deferredInput = useDeferredValue(input);
  const [file, setFile] = useState<{ name: string; size: number; bytes: Uint8Array } | null>(null);
  const [hmacEnabled, setHmacEnabled] = useState(false);
  const [secretKey, setSecretKey] = useState("");
  const deferredKey = useDeferredValue(secretKey);
  const [notice, setNotice] = useState("");

  // Memoized so the hashing below runs only when the message (or the key) changes.
  const message = useMemo<Uint8Array | null>(() => (source === "text" ? (deferredInput ? encoder.encode(deferredInput) : null) : file?.bytes ?? null), [source, deferredInput, file]);

  // The hashes depend on the message only: switching HMAC on or typing a key does not hash a large file again.
  const computed = useMemo<{ hashes: Results; failed: boolean }>(() => {
    if (message === null) return { hashes: {}, failed: false };
    try {
      return { hashes: hasher.hashAll(message), failed: false };
    } catch (error) {
      console.error("Error generating hashes:", error);
      return { hashes: {}, failed: true };
    }
  }, [message, hasher]);
  const macs = useMemo<Results>(() => {
    if (message === null || !hmacEnabled) return {};
    try {
      return hasher.hmacAll(message, encoder.encode(deferredKey));
    } catch (error) {
      console.error("Error generating HMACs:", error);
      return {};
    }
  }, [message, hmacEnabled, deferredKey, hasher]);
  const { hashes } = computed;
  const hmacs = macs;

  const chooseFile = async () => {
    setNotice("");
    try {
      const opened = await sdk.files.open({ as: "bytes" });
      if (opened) setFile(opened);
    } catch (error) {
      // A PermissionError says what to grant; the message of any other failure is shown as it is.
      setNotice(error instanceof Error ? error.message : "Could not read the file. Choose it again.");
    }
  };

  // Read-only result fields grow to show the whole hash at any width.
  const listRef = useRef<HTMLDivElement>(null);
  const fitHeight = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => list.querySelectorAll("textarea").forEach(fitHeight));
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const renderResult = (key: string, label: string, value: string, placeholder: string) => (
    <div key={key} className="flex items-start gap-2">
      <label className="w-28 shrink-0 pt-2 text-xs font-medium text-muted-foreground" htmlFor={`hash-out-${key}`}>{label}</label>
      <textarea id={`hash-out-${key}`} className={`${field} resize-none break-all`} value={value} readOnly rows={1} ref={fitHeight} placeholder={placeholder} />
      <CopyButton value={value} label={label} writeText={sdk.clipboard.writeText} onError={setNotice} />
    </div>
  );


  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Input source" className="inline-flex rounded-md bg-muted p-0.5">
          {(["text", "file"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={source === value}
              onClick={() => setSource(value)}
              className={`h-7 rounded px-3 text-sm ${source === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {value === "text" ? "Text" : "File"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground" htmlFor="hash-hmac">
          HMAC
          <input id="hash-hmac" type="checkbox" role="switch" checked={hmacEnabled} onChange={(event) => setHmacEnabled(event.target.checked)} className="h-4 w-4 accent-primary" />
        </label>
        {hmacEnabled && (
          <>
            <label htmlFor="hash-secret" className="text-xs text-foreground">Secret key</label>
            <input id="hash-secret" className={`${field} h-8 w-64 py-0 text-xs`} value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder="Enter secret key..." autoComplete="off" spellCheck={false} />
          </>
        )}
      </header>

      {source === "text" ? (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="hash-input" className="text-sm font-medium text-foreground">Input</label>
            {input && <button type="button" className={button} onClick={() => setInput("")}>Clear</button>}
          </div>
          <textarea id="hash-input" className={`${field} h-32 resize-y`} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Enter text to generate hashes..." spellCheck={false} />
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-foreground">File</h2>
          <div>
            <button type="button" className="h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90" onClick={() => void chooseFile()}>Choose file…</button>
          </div>
          {file && (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate" data-testid="hash-file-name">{file.name}</span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
              </span>
              <button type="button" className={button} onClick={() => setFile(null)}>Clear</button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">The file is read on this device. It is not uploaded.</p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">Hashes</h2>
        <div className="flex flex-col gap-2" ref={listRef}>
          {HASH_TYPES.map(({ type, label }) => renderResult(type, label, hashes[type] ?? "", `${label} hash will appear here...`))}
          {hmacEnabled && HMAC_TYPES.map(({ type, label }) => renderResult(`hmac-${type}`, label, hmacs[type] ?? "", `${label} will appear here...`))}
        </div>
      </section>

      <footer className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{message === null ? "Ready" : `${formatBytes(message.length)} hashed`}</span>
        {(notice || computed.failed) && <span role="alert" className="text-destructive">{notice || "Could not compute the hashes."}</span>}
      </footer>

      <section aria-label="Frequently asked questions" className="flex flex-col gap-2 border-t border-border pt-4">
        <h2 className="text-sm font-medium text-foreground">FAQ</h2>
        {FAQ_ITEMS.map((item) => (
          <details key={item.q} className="rounded-md border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">{item.q}</summary>
            <p className="mt-1.5 text-muted-foreground">{item.a}</p>
          </details>
        ))}
      </section>
    </main>
  );
}
