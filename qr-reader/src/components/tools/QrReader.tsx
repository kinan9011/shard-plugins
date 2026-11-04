import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ExternalLink, FileUp, ImageUp, ScanLine } from "lucide-react";
import { ToolFaqSection, type ToolFaqItem } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { getLocale, t as tNow, useT } from "@/lib/i18n";
import { formatBytes } from "@/utils/format-bytes";
import {
  decodeQrPixels,
  firstImageFile,
  parseQrPayload,
  readImagePixels,
  type QrDecodeResult,
  type QrPayload,
} from "@/utils/qr-reader";

const FAQ_KEYS = ["addImage", "notFound", "payloads", "several", "upload"] as const;

interface Source {
  /** Null for a pasted image, which has no file name; the label is built when it is shown. */
  name: string | null;
  size: number;
  previewUrl: string;
}

interface Decoded {
  width: number;
  height: number;
  result: QrDecodeResult | null;
}

const isVisible = (element: HTMLElement | null) => Boolean(element?.isConnected && !element.closest("[hidden]"));

export function QrReader() {
  const t = useT();
  const [source, setSource] = useState<Source | null>(null);
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const previewRef = useRef("");

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const handleImage = async (file: File | null | undefined) => {
    if (!file) return;
    const requestId = ++requestRef.current;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const previewUrl = URL.createObjectURL(file);
    previewRef.current = previewUrl;
    setSource({ name: file.name || null, size: file.size, previewUrl });
    setDecoded(null);
    setReadError("");
    setReading(true);
    try {
      const pixels = await readImagePixels(file);
      if (requestRef.current !== requestId) return;
      const result = decodeQrPixels(pixels);
      setDecoded({ width: pixels.width, height: pixels.height, result });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setReadError(error instanceof Error ? error.message : tNow("error.readFallback"));
    } finally {
      if (requestRef.current === requestId) setReading(false);
    }
  };

  // Pasting an image anywhere decodes it while this tool is the visible one. Text pastes pass through.
  const handleImageRef = useRef(handleImage);
  handleImageRef.current = handleImage;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!isVisible(dropRef.current)) return;
      const file = firstImageFile(event.clipboardData?.items, event.clipboardData?.files);
      if (!file) return;
      event.preventDefault();
      void handleImageRef.current(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const clear = () => {
    requestRef.current++;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setSource(null);
    setDecoded(null);
    setReadError("");
    setReading(false);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = firstImageFile(event.dataTransfer.items, event.dataTransfer.files);
    if (file) void handleImage(file);
    else setReadError(tNow("error.dropImage"));
  };

  const result = decoded?.result ?? null;
  const text = result?.text ?? "";
  // Built when it is shown, so its labels follow the app language.
  const payload = useMemo(() => (result ? parseQrPayload(result.text) : null), [result, t]);
  const notFound = Boolean(decoded && !result);
  const location = result?.location;
  const marker = decoded ? Math.max(decoded.width, decoded.height) / 120 : 0;

  const status = () => {
    if (reading) return <span>{t("status.reading")}</span>;
    if (readError) return <span className="text-destructive">{t("status.unreadable")}</span>;
    if (!decoded) return <span>{t("status.ready")}</span>;
    return (
      <>
        <span>{result ? t("status.found", { kind: payload?.label ?? "" }) : t("status.none")}</span>
        <span>{decoded.width} × {decoded.height} px</span>
      </>
    );
  };

  return (
    <ToolWorkspace
      id="qr-reader"
      toolbar={
        <>
          <input
            ref={fileInputRef}
            id="qr-reader-file"
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void handleImage(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button type="button" className="toolbar-text-button" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={14} aria-hidden="true" />
            {t("action.openImage")}
          </button>
          {source && (
            <button type="button" className="toolbar-text-button" onClick={clear}>
              {t("common.clear")}
            </button>
          )}
        </>
      }
      notice={
        readError ? (
          <div className="workspace-notice" data-tone="error" role="alert">{readError}</div>
        ) : notFound ? (
          <div className="workspace-notice" data-tone="error" role="alert">
            {t("notice.notFound")}
          </div>
        ) : undefined
      }
      first={
        <EditorPane title={t("pane.image")}>
          <div
            ref={dropRef}
            className={`flex h-full min-h-full flex-col ${dragging ? "bg-accent" : ""}`}
            data-testid="qr-reader-drop"
            data-dragging={dragging || undefined}
            onDragOver={onDragOver}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {source ? (
              <div className="space-y-3 p-4">
                <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm">
                  <ImageUp className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{source.name ?? t("image.pasted")}</span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(source.size)}</span>
                </div>
                <div className="relative inline-block max-w-full">
                  <img
                    src={source.previewUrl}
                    alt={t("image.previewAlt")}
                    className="block max-h-96 max-w-full rounded-md border bg-muted object-contain"
                  />
                  {decoded && location && (
                    <svg
                      className="pointer-events-none absolute inset-0 h-full w-full"
                      viewBox={`0 0 ${decoded.width} ${decoded.height}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      data-testid="qr-reader-outline"
                    >
                      <polygon
                        className="fill-primary/15 stroke-primary"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                        points={[location.topLeft, location.topRight, location.bottomRight, location.bottomLeft]
                          .map((p) => `${p.x},${p.y}`)
                          .join(" ")}
                      />
                      {[location.topLeft, location.topRight, location.bottomRight, location.bottomLeft].map((p, i) => (
                        <circle key={i} className="fill-primary" cx={p.x} cy={p.y} r={marker} />
                      ))}
                    </svg>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t("image.local")}</p>
              </div>
            ) : (
              <PaneEmpty
                icon={<ScanLine size={22} aria-hidden="true" />}
                title={t("empty.dropTitle")}
                hint={t("empty.dropHint")}
              />
            )}
          </div>
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.decoded")} htmlFor={text ? "qr-reader-output" : undefined} scroll={false}
          actions={<CopyButton value={text} label={t("copy.text")} />}>
          {result && payload ? (
            <>
              <div className="result-list">
                <div className="result-row">
                  <span className="result-row-label">{t("payload.type")}</span>
                  <span className="result-row-value" data-testid="qr-reader-kind">{payload.label}</span>
                  {payload.href ? (
                    <a className="toolbar-text-button" href={payload.href} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} aria-hidden="true" />
                      {payload.kind === "email" ? t("action.writeEmail") : t("action.openLink")}
                    </a>
                  ) : (
                    <span />
                  )}
                </div>
                {payload.fields.map((field) => (
                  <div key={field.label} className="result-row">
                    <span className="result-row-label">{field.label}</span>
                    <span className="result-row-value" dir="auto">{field.value}</span>
                    <CopyButton value={field.value} iconOnly label={t("copy.field", { field: getLocale() === "en" ? field.label.toLowerCase() : field.label })} />
                  </div>
                ))}
              </div>
              <CodeTextarea id="qr-reader-output" value={text} readOnly />
            </>
          ) : (
            <PaneEmpty
              title={reading ? t("empty.reading") : t("empty.decoded")}
              hint={notFound ? t("empty.notFound") : t("empty.addImage")}
            />
          )}
        </EditorPane>
      }
      status={status()}
      help={<ToolFaqSection items={FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }))} />}
    />
  );
}
