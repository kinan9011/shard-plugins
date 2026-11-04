import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, ImageOff } from "lucide-react";
import { toast } from "@/shims/sonner";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { formatList, useT } from "@/lib/i18n";
import { formatBytes } from "@/utils/format-bytes";
import { byteLength, convertSvg, type SvgResult } from "@/utils/svg-to-css";

const FAQ_KEYS = ["dataUri", "mask", "removed", "namespace"] as const;

const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n  <path d="M12 2 2 22h20L12 2z" fill="#0ea5e9"/>\n</svg>';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

type Output = { key: string; label: string; value: string };

export function SvgToCss() {
  const t = useT();
  const [input, setInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const text = useDebouncedValue(input);

  const result = useMemo<SvgResult | null>(() => (text.trim() ? convertSvg(text) : null), [text, t]);
  const conversion = result && "svg" in result ? result : null;
  const error = result && "error" in result ? result.error : "";

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t("toast.tooLarge", { size: formatBytes(file.size) }));
      return;
    }
    try {
      setInput(await file.text());
    } catch {
      toast.error(t("toast.readFailed"));
    }
  };

  const outputs: Output[] = conversion
    ? [
        { key: "mini", label: t("output.mini"), value: conversion.miniDataUri },
        { key: "base64", label: t("output.base64"), value: conversion.base64DataUri },
        { key: "background", label: t("output.background"), value: conversion.backgroundCss },
        { key: "mask", label: t("output.mask"), value: conversion.maskCss },
        { key: "img", label: t("output.img"), value: conversion.imgTag },
        { key: "svg", label: t("output.svg"), value: conversion.svg },
      ]
    : [];

  // Read-only result fields grow to show the whole value at any pane width
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
  }, [conversion]);

  const removed = conversion ? conversion.scripts + conversion.handlers : 0;
  const warning = conversion && removed > 0
    ? t("warning.removed", {
        items: formatList(
          [
            conversion.scripts ? t("warning.scripts", { count: conversion.scripts }) : "",
            conversion.handlers ? t("warning.handlers", { count: conversion.handlers }) : "",
          ].filter(Boolean),
        ),
      })
    : "";

  const inputBytes = byteLength(text);

  return (
    <ToolWorkspace
      id="svg-to-css"
      notice={
        error ? (
          <div className="workspace-notice" data-tone="error" role="alert">{error}</div>
        ) : warning || conversion?.notes.length ? (
          <div className="workspace-notice" role="status">
            {[warning, ...(conversion?.notes ?? [])].filter(Boolean).join(" ")}
          </div>
        ) : undefined
      }
      first={
        <EditorPane
          title={t("pane.svg")}
          htmlFor="svg-to-css-input"
          scroll={false}
          actions={
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".svg,image/svg+xml"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  void openFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button type="button" className="toolbar-text-button" onClick={() => fileInputRef.current?.click()}>
                <FileUp size={14} aria-hidden="true" />
                {t("action.openFile")}
              </button>
              {input && <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button>}
            </>
          }
        >
          <CodeTextarea id="svg-to-css-input" wrap="off" placeholder={PLACEHOLDER} value={input} onChange={(e) => setInput(e.target.value)} />
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.output")}>
          {conversion ? (
            <div className="result-list" ref={listRef}>
              <div className="flex items-center gap-4 border-b border-border px-4 py-3">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md border border-border bg-muted p-2">
                  <img src={conversion.miniDataUri} alt={t("preview.alt")} className="max-h-full max-w-full" />
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{t("info.input")}</dt>
                  <dd>{formatBytes(inputBytes)}</dd>
                  <dt className="text-muted-foreground">{t("info.optimized")}</dt>
                  <dd>{formatBytes(byteLength(conversion.svg))}</dd>
                  <dt className="text-muted-foreground">{t("info.size")}</dt>
                  <dd>{conversion.width && conversion.height ? `${conversion.width} × ${conversion.height}` : t("info.notSet")}</dd>
                </dl>
              </div>
              {outputs.map(({ key, label, value }) => (
                <div key={key} className="result-row">
                  <label className="result-row-label" htmlFor={`svg-to-css-${key}`}>
                    {label}
                    <span className="block text-2xs font-normal">{formatBytes(byteLength(value))}</span>
                  </label>
                  <textarea
                    id={`svg-to-css-${key}`}
                    className="result-row-value code-textarea"
                    dir="ltr"
                    value={value}
                    readOnly
                    rows={1}
                    ref={fitHeight}
                  />
                  <CopyButton value={value} iconOnly label={t("copy.label", { label })} />
                </div>
              ))}
            </div>
          ) : (
            <PaneEmpty
              icon={error ? <ImageOff size={20} aria-hidden="true" /> : undefined}
              title={error ? t("empty.error") : t("empty.title")}
              hint={error ? undefined : t("empty.hint")}
            />
          )}
        </EditorPane>
      }
      status={
        error ? (
          <span className="text-destructive">{t("status.invalid")}</span>
        ) : conversion ? (
          <>
            <span>{t("status.in", { size: formatBytes(inputBytes) })}</span>
            <span>{t("status.mini", { size: formatBytes(byteLength(conversion.miniDataUri)) })}</span>
            <span>{t("status.base64", { size: formatBytes(byteLength(conversion.base64DataUri)) })}</span>
          </>
        ) : (
          <span>{t("status.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
