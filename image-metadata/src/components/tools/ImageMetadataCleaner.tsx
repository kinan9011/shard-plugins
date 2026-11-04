import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { zipSync } from "fflate";
import { FileUp, ImageIcon, LoaderCircle, ShieldOff, Sparkles, X } from "lucide-react";
import { toast } from "@/shims/sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { MetadataFindingRow } from "@/components/tools/MetadataFindingRow";
import { EditorPane, PaneEmpty, PaneOpenFile, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { saveFile } from "@/lib/desktop";
import { formatList, t as tNow, useT } from "@/lib/i18n";
import { formatBytes } from "@/utils/format-bytes";
import {
  FINDING_KIND_KEYS,
  FINDING_KIND_ORDER,
  FORMAT_LABELS,
  FORMAT_MIME,
  cleanFileName,
  cleanImage,
  detectImageFormat,
  inspectImage,
  remainingMetadata,
  scanForMetadataMarkers,
  type CleanOptions,
  type CleanResult,
  type MetadataFinding,
} from "@/utils/image-metadata";
import {
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_QUALITY,
  OUTPUT_FORMATS,
  outputMime,
  reencodeImage,
  usesQuality,
  type OutputFormat,
} from "@/utils/image-reencode";

const FAQ_KEYS = ["find", "preserve", "watermark", "rotated", "share"] as const;

const ACCEPT = "image/jpeg,image/png,image/webp";

interface Item {
  id: string;
  name: string;
  size: number;
  blob: Blob;
  bytes: Uint8Array;
  previewUrl: string;
}

interface Output {
  bytes: Uint8Array;
  name: string;
  mime: string;
  formatLabel: string;
  /** Labels of metadata still in the output. Empty means none left. */
  remaining: string[];
}

const isVisible = (element: HTMLElement | null) => Boolean(element?.isConnected && !element.closest("[hidden]"));

const readBytes = (file: Blob) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error(tNow("error.readFile")));
    reader.readAsArrayBuffer(file);
  });

const objectUrl = (blob: Blob) => {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : "";
  } catch {
    return "";
  }
};

const revoke = (url: string) => {
  try {
    if (url) URL.revokeObjectURL(url);
  } catch {
    /* Nothing to release. */
  }
};

const imageFiles = (items?: DataTransferItemList | null, files?: FileList | null): File[] => {
  const out: File[] = [];
  for (const item of Array.from(items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  if (out.length) return out;
  return Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
};

const uniqueName = (name: string, used: Map<string, number>) => {
  const count = used.get(name) ?? 0;
  used.set(name, count + 1);
  if (!count) return name;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? `${name}-${count + 1}` : `${name.slice(0, dot)}-${count + 1}${name.slice(dot)}`;
};

/** Four format cards with radio group keyboard behavior. */
function FormatPicker({ value, onChange, disabled }: { value: OutputFormat; onChange: (f: OutputFormat) => void; disabled: boolean }) {
  const t = useT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = OUTPUT_FORMATS.length - 1;
    // In a right-to-left page the arrow keys follow the reading direction.
    const rtl = document.documentElement.dir === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    const next =
      event.key === forward || event.key === "ArrowDown"
        ? (index + 1) % OUTPUT_FORMATS.length
        : event.key === back || event.key === "ArrowUp"
          ? (index - 1 + OUTPUT_FORMATS.length) % OUTPUT_FORMATS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(OUTPUT_FORMATS[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={t("format.group")} aria-disabled={disabled || undefined} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {OUTPUT_FORMATS.map((format, index) => {
        const checked = value === format.id;
        return (
          <button
            key={format.id}
            ref={(el) => (refs.current[index] = el)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(format.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`flex min-w-28 flex-col items-start rounded-md border px-3 py-2 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
            }`}
          >
            <span className="text-sm font-semibold">{format.title}</span>
            <span className={`text-2xs ${checked ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{t(format.captionKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ImageMetadataCleaner() {
  const t = useT();
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [preserve, setPreserve] = useState(false);
  const [keepColorProfile, setKeepColorProfile] = useState(true);
  const [keepOrientation, setKeepOrientation] = useState(true);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(DEFAULT_OUTPUT_FORMAT);
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [outputs, setOutputs] = useState<Record<string, Output>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  useEffect(() => () => itemsRef.current.forEach((item) => revoke(item.previewUrl)), []);

  const options: CleanOptions = useMemo(() => ({ keepColorProfile, keepOrientation }), [keepColorProfile, keepOrientation]);

  // Output settings changed, so earlier outputs no longer match.
  useEffect(() => setOutputs({}), [preserve, options, outputFormat, quality, t]);

  const analyses = useMemo(() => {
    const map = new Map<string, { result?: CleanResult; error?: string }>();
    for (const item of items) {
      try {
        map.set(item.id, { result: cleanImage(item.bytes, options) });
      } catch (e) {
        map.set(item.id, { error: e instanceof Error ? e.message : t("error.unreadable") });
      }
    }
    return map;
  }, [items, options, t]);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setError("");
    const added: Item[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      try {
        const bytes = await readBytes(file);
        const format = detectImageFormat(bytes);
        if (format !== "jpeg" && format !== "png" && format !== "webp") {
          rejected.push(file.name || t("file.pasted"));
          continue;
        }
        added.push({
          id: `img-${++idRef.current}`,
          name: file.name || `pasted-image.${format === "jpeg" ? "jpg" : format}`,
          size: bytes.length,
          blob: file,
          bytes,
          previewUrl: objectUrl(file),
        });
      } catch {
        setError(file.name ? t("error.readNamed", { name: file.name }) : t("error.readPasted"));
      }
    }
    setSkipped(rejected);
    if (added.length) {
      setItems((prev) => [...prev, ...added]);
      setSelectedId((current) => current ?? added[0].id);
    }
  };

  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!isVisible(dropRef.current)) return;
      const files = imageFiles(event.clipboardData?.items, event.clipboardData?.files);
      if (!files.length) return;
      event.preventDefault();
      void addFilesRef.current(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const removeItem = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item) revoke(item.previewUrl);
    const rest = items.filter((i) => i.id !== id);
    setItems(rest);
    if (selectedId === id) setSelectedId(rest[0]?.id ?? null);
  };

  const clearAll = () => {
    items.forEach((item) => revoke(item.previewUrl));
    setItems([]);
    setSelectedId(null);
    setOutputs({});
    setSkipped([]);
    setError("");
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
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) void addFiles(files);
    else setError(t("error.dropImages"));
  };

  /** Builds clean outputs for the given items. */
  const process = async (targets: Item[]) => {
    const results: Record<string, Output> = {};
    setProgress({ done: 0, total: targets.length });
    setError("");
    try {
      for (const [index, item] of targets.entries()) {
        const cached = outputs[item.id];
        if (cached) {
          results[item.id] = cached;
        } else if (preserve) {
          const analysis = analyses.get(item.id);
          if (!analysis?.result) throw new Error(t("error.item", { name: item.name, message: analysis?.error ?? t("error.unreadable") }));
          const { bytes, after } = analysis.result;
          results[item.id] = {
            bytes,
            name: cleanFileName(item.name, after.format),
            mime: FORMAT_MIME[after.format],
            formatLabel: FORMAT_LABELS[after.format],
            remaining: remainingMetadata(after).map((f) => f.label),
          };
        } else {
          let bytes: Uint8Array;
          try {
            bytes = await reencodeImage(item.blob, outputFormat, quality);
          } catch (e) {
            throw new Error(t("error.item", { name: item.name, message: e instanceof Error ? e.message : t("error.reencode") }));
          }
          const format = detectImageFormat(bytes);
          const remaining =
            format === "jpeg" || format === "png" || format === "webp" ? remainingMetadata(inspectImage(bytes)).map((f) => f.label) : scanForMetadataMarkers(bytes);
          results[item.id] = {
            bytes,
            name: cleanFileName(item.name, outputFormat),
            mime: outputMime(outputFormat),
            formatLabel: OUTPUT_FORMATS.find((f) => f.id === outputFormat)!.title,
            remaining,
          };
        }
        setProgress({ done: index + 1, total: targets.length });
        // Let the button label and the list repaint between images.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      setOutputs((prev) => ({ ...prev, ...results }));
      return results;
    } catch (e) {
      setOutputs((prev) => ({ ...prev, ...results }));
      setError(e instanceof Error ? e.message : t("error.cleanFailed"));
      return null;
    } finally {
      setProgress(null);
    }
  };

  const saveOne = async (output: Output) => {
    try {
      if (await saveFile(new Blob([output.bytes.slice()], { type: output.mime }), output.name)) toast.success(t("toast.saved", { name: output.name }));
    } catch {
      setError(t("error.save"));
    }
  };

  const saveZip = async (list: Output[]) => {
    const used = new Map<string, number>();
    const entries = Object.fromEntries(list.map((output) => [uniqueName(output.name, used), output.bytes] as const));
    const zip = zipSync(entries, { level: 0 });
    try {
      if (await saveFile(new Blob([zip.slice()], { type: "application/zip" }), "clean-images.zip")) {
        toast.success(t("toast.savedZip", { count: list.length }));
      }
    } catch {
      setError(t("error.saveZip"));
    }
  };

  const cleanAll = async () => {
    const results = await process(items);
    if (!results) return;
    const list = items.map((item) => results[item.id]);
    if (list.length === 1) await saveOne(list[0]);
    else await saveZip(list);
  };

  const selected = items.find((item) => item.id === selectedId) ?? null;

  const saveSelected = async () => {
    if (!selected) return;
    const results = await process([selected]);
    if (results) await saveOne(results[selected.id]);
  };

  const selectedAnalysis = selected ? analyses.get(selected.id) : undefined;
  const selectedResult = selectedAnalysis?.result;
  const selectedOutput = selected ? outputs[selected.id] : undefined;
  const busy = progress !== null;

  const counts = useMemo(() => {
    let ai = 0;
    let location = 0;
    for (const item of items) {
      const before = analyses.get(item.id)?.result?.before;
      if (before?.hasAi) ai++;
      if (before?.hasLocation) location++;
    }
    return { ai, location };
  }, [items, analyses]);

  const grouped = useMemo(() => {
    const findings = selectedResult?.before.findings ?? [];
    return FINDING_KIND_ORDER.map((kind) => ({ kind, findings: findings.filter((f) => f.kind === kind) })).filter((g) => g.findings.length);
  }, [selectedResult]);

  const isRemoved = (finding: MetadataFinding) => (preserve ? finding.removable : finding.label !== "JFIF header");
  const orientationWarning = preserve && !keepOrientation && (selectedResult?.before.orientation ?? 1) > 1;
  const mainLabel = busy
    ? t("action.cleaning", { current: Math.min(progress.done + 1, progress.total), total: progress.total })
    : t("action.clean", { count: items.length });

  const outputSummary = (item: Item, output: Output) =>
    t("output.summary", {
      format: output.formatLabel,
      from: formatBytes(item.size),
      to: formatBytes(output.bytes.length),
      rest: output.remaining.length ? t("output.stillHas", { labels: formatList(output.remaining) }) : t("output.clean"),
    });

  return (
    <ToolWorkspace
      id="image-metadata"
      toolbar={
        <>
          <input
            ref={fileInputRef}
            id="image-metadata-file"
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <FileUp aria-hidden="true" />
            {t("action.openImages")}
          </Button>
          {items.length > 0 && (
            <button type="button" className="toolbar-text-button" onClick={clearAll} disabled={busy}>
              {t("common.clear")}
            </button>
          )}
          {preserve && (
            <>
              <label className="option-switch indent-control" htmlFor="image-metadata-keep-color">
                {t("option.keepColorProfile")}
                <Switch id="image-metadata-keep-color" checked={keepColorProfile} onCheckedChange={setKeepColorProfile} disabled={busy} />
              </label>
              <label className="option-switch" htmlFor="image-metadata-keep-orientation">
                {t("option.keepOrientation")}
                <Switch id="image-metadata-keep-orientation" checked={keepOrientation} onCheckedChange={setKeepOrientation} disabled={busy} />
              </label>
            </>
          )}
          <Button size="sm" onClick={() => void cleanAll()} disabled={!items.length || busy} aria-busy={busy || undefined}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}
            {mainLabel}
          </Button>
          {items.length > 1 && selected && (
            <button type="button" className="toolbar-text-button" onClick={() => void saveSelected()} disabled={busy}>
              {t("action.saveCopy")}
            </button>
          )}
        </>
      }
      secondaryToolbar={
        <div className="flex w-full flex-wrap items-start gap-x-6 gap-y-3">
          <div className="max-w-xs space-y-1">
            <label className="option-switch" htmlFor="image-metadata-preserve">
              {t("option.preserve")}
              <Switch id="image-metadata-preserve" checked={preserve} onCheckedChange={setPreserve} disabled={busy} aria-describedby="image-metadata-preserve-help" />
            </label>
            <p id="image-metadata-preserve-help" className="text-2xs text-muted-foreground">
              {t(preserve ? "preserve.helpOn" : "preserve.helpOff")}
            </p>
          </div>
          <FormatPicker value={outputFormat} onChange={setOutputFormat} disabled={preserve || busy} />
          {!preserve && usesQuality(outputFormat) && (
            <div className="flex items-center gap-2 self-center text-xs">
              <label htmlFor="image-metadata-quality">{t("quality.label")}</label>
              <input
                id="image-metadata-quality"
                type="range"
                min={1}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                disabled={busy}
                className="w-32 accent-primary"
              />
              <span className="w-7 tabular-nums text-muted-foreground">{quality}</span>
            </div>
          )}
        </div>
      }
      notice={
        <>
          {error && (
            <div className="workspace-notice" data-tone="error" role="alert">
              {error}
            </div>
          )}
          {skipped.length > 0 && (
            <div className="workspace-notice" role="status">
              {t("notice.unsupported", { names: formatList(skipped) })}
            </div>
          )}
        </>
      }
      first={
        <EditorPane title={t("pane.images")}>
          <div
            ref={dropRef}
            className={`flex h-full min-h-full flex-col ${dragging ? "bg-accent" : ""}`}
            data-testid="image-metadata-drop"
            data-dragging={dragging || undefined}
            onDragOver={onDragOver}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {items.length ? (
              <ul className="flex flex-col" aria-label={t("list.label")}>
                {items.map((item) => {
                  const analysis = analyses.get(item.id);
                  const before = analysis?.result?.before;
                  const output = outputs[item.id];
                  const active = item.id === selectedId;
                  return (
                    <li key={item.id} className={`flex items-center gap-2 border-b border-border/50 pe-2 ${active ? "bg-muted" : ""}`}>
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2 text-start"
                        aria-pressed={active}
                        onClick={() => setSelectedId(item.id)}
                      >
                        {item.previewUrl ? (
                          <img src={item.previewUrl} alt="" className="h-10 w-10 shrink-0 rounded border bg-muted object-cover" />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border bg-muted">
                            <ImageIcon size={16} aria-hidden="true" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm" dir="auto">{item.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {before ? FORMAT_LABELS[before.format] : t("list.unreadable")} · {formatBytes(item.size)} ·{" "}
                            {before ? t("list.items", { count: before.findings.length }) : analysis?.error}
                          </span>
                          {output && <span className="block text-2xs text-muted-foreground">{outputSummary(item, output)}</span>}
                        </span>
                        {before?.hasAi && (
                          <span className="shrink-0 rounded bg-warning px-1.5 py-0.5 text-2xs font-semibold text-warning-foreground">AI</span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="toolbar-text-button"
                        aria-label={t("list.remove", { name: item.name })}
                        onClick={() => removeItem(item.id)}
                        disabled={busy}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <PaneOpenFile
                icon={<ImageIcon size={22} aria-hidden="true" />}
                title={t("empty.drop.title")}
                hint={t("empty.drop.hint")}
                onClick={() => fileInputRef.current?.click()}
              />
            )}
          </div>
        </EditorPane>
      }
      second={
        <EditorPane title={selected ? t("pane.metadataIn", { name: selected.name }) : t("pane.metadata")}>
          {selected && selectedResult ? (
            <div className="flex flex-col">
              <div className="space-y-1 border-b border-border/50 px-4 py-3 text-xs" data-testid="image-metadata-summary">
                {preserve ? (
                  <p>
                    {selectedResult.removedCount
                      ? t("summary.removed", { count: selectedResult.removedCount, size: formatBytes(Math.max(0, selectedResult.savedBytes)) })
                      : t("summary.none")}
                  </p>
                ) : (
                  <p>{t("summary.reencode", { format: OUTPUT_FORMATS.find((f) => f.id === outputFormat)!.title })}</p>
                )}
                {selectedOutput && <p className="text-muted-foreground">{t("output.label", { summary: outputSummary(selected, selectedOutput) })}</p>}
              </div>
              {orientationWarning && (
                <div className="workspace-notice" role="status">
                  {t("notice.orientation", { value: selectedResult.before.orientation ?? 1 })}
                </div>
              )}
              {grouped.length ? (
                grouped.map((group) => (
                  <section key={group.kind} aria-labelledby={`image-metadata-group-${group.kind}`}>
                    <h3
                      id={`image-metadata-group-${group.kind}`}
                      className={`flex items-center gap-1.5 px-4 pb-1 pt-3 text-xs font-semibold ${group.kind === "ai" ? "text-warning" : "text-muted-foreground"}`}
                    >
                      {group.kind === "ai" && <Sparkles size={13} aria-hidden="true" />}
                      {t(FINDING_KIND_KEYS[group.kind])}
                    </h3>
                    <div className="result-list">
                      {group.findings.map((finding, index) => (
                        <MetadataFindingRow key={`${finding.label}-${index}`} id={`image-metadata-${group.kind}-${index}`} finding={finding} removed={isRemoved(finding)} />
                      ))}
                    </div>
                  </section>
                ))
              ) : (
                <p className="px-4 py-3 text-sm text-muted-foreground">{t("empty.noMetadata")}</p>
              )}
              <p className="px-4 py-3 text-xs text-muted-foreground">
                {t("note.watermark")}
              </p>
            </div>
          ) : selected && selectedAnalysis?.error ? (
            <PaneEmpty title={t("empty.unreadable.title")} hint={selectedAnalysis.error} />
          ) : (
            <PaneEmpty title={t("empty.metadata.title")} hint={t("empty.metadata.hint")} />
          )}
        </EditorPane>
      }
      status={
        items.length ? (
          <span>
            {[t("status.images", { count: items.length }), t("status.ai", { count: counts.ai }), t("status.location", { count: counts.location })].join(" · ")}
          </span>
        ) : (
          <span>{t("status.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
