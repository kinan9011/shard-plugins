import { useEffect, useRef, useState } from "react";
import { useT } from "./lib/i18n";

/** Copies through the host (needs `clipboard:write`) and confirms in place. A refusal is reported with `onError`. */
export function CopyButton({ value, label, writeText, onError }: { value: string; label: string; writeText: (text: string) => Promise<void>; onError: (message: string) => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("common.copyFailed"));
    }
  };

  return (
    <button
      type="button"
      aria-label={t("copy.label", { label })}
      disabled={!value}
      onClick={() => void copy()}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {copied ? <path d="M20 6 9 17l-5-5" /> : <><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>}
      </svg>
      <span className="sr-only" role="status" aria-live="polite">{copied ? t("common.copied") : ""}</span>
    </button>
  );
}
