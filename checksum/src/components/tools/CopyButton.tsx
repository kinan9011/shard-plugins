import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "@/shims/sonner";
import { sdk } from "@/sdk";

interface CopyButtonProps {
  /** A function is read on click, so a large value is not built on every render. */
  value: string | (() => string);
  /** Visible label. Also names the button for screen readers, e.g. "Copy SHA-256". */
  label?: string;
  /** Accessible name when it differs from the visible label. */
  ariaLabel?: string;
  /** Icon-only variant for tight rows. Needs an ariaLabel. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Copies a value and confirms in place: the icon turns into a check and a
 * polite live region announces "Copied". Only failures raise a toast.
 */
export function CopyButton({ value, label = "Copy", ariaLabel, iconOnly = false, className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await sdk.clipboard.writeText(typeof value === "function" ? value() : value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  };

  const Icon = copied ? Check : Copy;

  return (
    <button
      type="button"
      className={`toolbar-text-button copy-button ${className}`}
      onClick={copy}
      disabled={typeof value === "string" && !value}
      aria-label={ariaLabel ?? (iconOnly ? label : undefined)}
      data-copied={copied || undefined}
    >
      <Icon size={14} aria-hidden="true" />
      {!iconOnly && (copied ? "Copied" : label)}
      <span className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</span>
    </button>
  );
}
