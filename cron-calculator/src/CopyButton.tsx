import { useT } from "./lib/i18n";
import { createContext, useContext, useEffect, useRef, useState } from "react";

/** How the tool copies: through the host (`sdk.clipboard.writeText`, needs `clipboard:write`). */
export interface Clipboard {
  writeText: (text: string) => Promise<void>;
  /** Tells the user why a copy failed (a denied permission, mostly). */
  onError: (message: string) => void;
}

const ClipboardContext = createContext<Clipboard | null>(null);
export const ClipboardProvider = ClipboardContext.Provider;

interface CopyButtonProps {
  /** A function is read on click, so a large value is not built on every render. */
  value: string | (() => string);
  /** Visible label (default "Copy"). Also names the button for screen readers, e.g. "Copy SHA-256". */
  label?: string;
  /** Accessible name when it differs from the visible label. */
  ariaLabel?: string;
  /** Icon-only variant for tight rows. Needs a label or ariaLabel. */
  iconOnly?: boolean;
  className?: string;
}

/** Copies a value and confirms in place: the icon turns into a check and a polite live region says "Copied". A refusal goes to `onError`. */
export function CopyButton({ value, label, ariaLabel, iconOnly = false, className = "" }: CopyButtonProps) {
  const t = useT();
  const clipboard = useContext(ClipboardContext);
  const shownLabel = label ?? t("common.copy");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      if (!clipboard) throw new Error(t("cron.error.notConnected"));
      await clipboard.writeText(typeof value === "function" ? value() : value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      clipboard?.onError(error instanceof Error ? error.message : t("common.copyFailed"));
    }
  };

  return (
    <button
      type="button"
      className={`toolbar-text-button ${className}`}
      onClick={() => void copy()}
      disabled={typeof value === "string" && !value}
      aria-label={ariaLabel ?? (iconOnly ? shownLabel : undefined)}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {copied ? <path d="M20 6 9 17l-5-5" /> : <><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>}
      </svg>
      {!iconOnly && (copied ? t("common.copied") : shownLabel)}
      <span className="sr-only" aria-live="polite">{copied ? t("common.copied") : ""}</span>
    </button>
  );
}
