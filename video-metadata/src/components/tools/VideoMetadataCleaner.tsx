import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileUp, FileVideo, LoaderCircle, ShieldOff, Sparkles } from "lucide-react";
import { toast } from "@/shims/sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MetadataFindingRow } from "@/components/tools/MetadataFindingRow";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { EditorPane, PaneEmpty, PaneOpenFile, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { saveFile } from "@/lib/desktop";
import { formatNumber, useT } from "@/lib/i18n";
import { blobSource } from "@/utils/byte-source";
import { formatBytes } from "@/utils/format-bytes";
import { FINDING_KIND_LABEL_KEYS, FINDING_KIND_ORDER } from "@/utils/image-metadata";
import { DEFAULT_VIDEO_OPTIONS, MAX_VIDEO_BYTES, VIDEO_ACCEPT, VIDEO_FORMAT_LABELS, cleanVideoName, type VideoCleanOptions } from "@/utils/video-format";
import { cleanVideo, inspectVideo, type VideoCleanResult, type VideoInspection } from "@/utils/video-metadata";

const FAQ_KEYS = ["removes", "reencode", "watermark", "kept", "upload"] as const;

export function VideoMetadataCleaner() {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<VideoCleanOptions>(DEFAULT_VIDEO_OPTIONS);
  const [inspection, setInspection] = useState<VideoInspection | null>(null);
  const [result, setResult] = useState<VideoCleanResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setBusy(true);
    setError("");
    setResult(null);
    inspectVideo(blobSource(file), options)
      .then((next) => {
        if (!cancelled) setInspection(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setInspection(null);
        setError(err instanceof Error ? err.message : t("error.readVideo"));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // The findings carry text in the current language, so a language change scans the file again.
  }, [file, options, t]);

  const openFile = (next: File | undefined) => {
    if (!next) return;
    if (next.size > MAX_VIDEO_BYTES) {
      setFile(null);
      setInspection(null);
      setResult(null);
      setError(t("error.tooLarge", { size: formatBytes(next.size), max: formatBytes(MAX_VIDEO_BYTES) }));
      return;
    }
    setFile(next);
  };

  const save = async () => {
    if (!file || !inspection) return;
    setBusy(true);
    try {
      const cleaned = await cleanVideo(file, inspection, options);
      setResult(cleaned);
      const name = cleanVideoName(file.name, inspection.format);
      if (await saveFile(cleaned.blob, name)) toast.success(t("toast.saved", { name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    setDragging(false);
    openFile(event.dataTransfer.files[0]);
  };

  const setOption = (key: keyof VideoCleanOptions) => (value: boolean) => setOptions((current) => ({ ...current, [key]: value }));
  const findings = inspection?.findings ?? [];
  const removable = findings.filter((f) => f.removable).length;
  const matroska = inspection?.format === "mkv" || inspection?.format === "webm";
  const left = result?.after.findings.filter((f) => f.removable) ?? [];

  const notice = () => {
    if (error) return <div className="workspace-notice" data-tone="error" role="alert">{error}</div>;
    if (!result) return undefined;
    return (
      <div className="workspace-notice" role="status">
        {result.after.warnings.length
          ? t("notice.incomplete", { count: result.removedCount, number: formatNumber(result.removedCount), warnings: result.after.warnings.join(" ") })
          : left.length
          ? t("notice.left", { count: left.length, number: formatNumber(left.length), labels: left.map((f) => f.label).join(", ") })
          : t("notice.clean", { count: result.removedCount, number: formatNumber(result.removedCount) })}
      </div>
    );
  };

  const status = () => {
    if (busy) return <span>{t("status.reading")}</span>;
    if (!inspection) return <span>{t("status.ready")}</span>;
    return (
      <span>
        {VIDEO_FORMAT_LABELS[inspection.format]} · {formatBytes(inspection.size)} · {t("status.toRemove", { count: removable, number: formatNumber(removable) })}
        {inspection.hasAi ? ` · ${t("status.ai")}` : ""}
        {inspection.hasLocation ? ` · ${t("status.location")}` : ""}
      </span>
    );
  };

  return (
    <ToolWorkspace
      id="video-metadata"
      toolbar={
        <>
          <input
            ref={inputRef}
            id="video-metadata-file"
            type="file"
            accept={VIDEO_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              openFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            <FileUp aria-hidden="true" />
            {t("action.open")}
          </Button>
          <label className="option-switch indent-control" htmlFor="video-metadata-dates">
            {t("option.clearDates")}
            <Switch id="video-metadata-dates" checked={options.clearDates} onCheckedChange={setOption("clearDates")} disabled={busy} />
          </label>
          <label className="option-switch" htmlFor="video-metadata-tracks">
            {t("option.removeTracks")}
            <Switch id="video-metadata-tracks" checked={options.removeMetadataTracks} onCheckedChange={setOption("removeMetadataTracks")} disabled={busy} />
          </label>
          {matroska && (
            <label className="option-switch" htmlFor="video-metadata-fonts">
              {t("option.keepFonts")}
              <Switch id="video-metadata-fonts" checked={options.keepFonts} onCheckedChange={setOption("keepFonts")} disabled={busy} />
            </label>
          )}
          <Button size="sm" onClick={() => void save()} disabled={!inspection || busy} aria-busy={busy || undefined}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}
            {t("action.save")}
          </Button>
        </>
      }
      notice={notice()}
      first={
        <EditorPane title={t("pane.video")}>
          <div
            className={`flex h-full min-h-full flex-col ${dragging ? "bg-accent" : ""}`}
            data-dragging={dragging || undefined}
            onDragOver={onDragOver}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {file ? (
              <div className="space-y-3 p-4">
                <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm">
                  <FileVideo className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate" dir="auto">{file.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{t("file.local")}</p>
                {inspection?.warnings.map((warning) => (
                  <p key={warning} className="text-xs text-muted-foreground">
                    {warning}
                  </p>
                ))}
              </div>
            ) : (
              <PaneOpenFile
                icon={<FileVideo size={20} aria-hidden="true" />}
                title={t("drop.title")}
                hint={t("drop.hint")}
                onClick={() => inputRef.current?.click()}
              />
            )}
          </div>
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.metadata")}>
          {!inspection ? (
            <PaneEmpty title={t("empty.title")} hint={t("empty.hint")} />
          ) : findings.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t("findings.none")}</p>
          ) : (
            FINDING_KIND_ORDER.filter((kind) => findings.some((f) => f.kind === kind)).map((kind) => (
              <section key={kind} aria-labelledby={`video-metadata-group-${kind}`}>
                <h3
                  id={`video-metadata-group-${kind}`}
                  className={`flex items-center gap-1.5 px-4 pb-1 pt-3 text-xs font-semibold ${kind === "ai" ? "text-warning" : "text-muted-foreground"}`}
                >
                  {kind === "ai" && <Sparkles size={13} aria-hidden="true" />}
                  {t(FINDING_KIND_LABEL_KEYS[kind])}
                </h3>
                <div className="result-list">
                  {findings
                    .filter((f) => f.kind === kind)
                    .map((finding, index) => (
                      <MetadataFindingRow key={`${finding.label}-${index}`} id={`video-metadata-${kind}-${index}`} finding={finding} removed={finding.removable} />
                    ))}
                </div>
              </section>
            ))
          )}
        </EditorPane>
      }
      status={status()}
      help={<ToolFaqSection items={FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }))} />}
    />
  );
}
