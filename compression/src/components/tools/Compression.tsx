import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, FileArchive, FileUp } from "lucide-react";
import { toast } from "@/shims/sonner";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { t as tNow, useT } from "@/lib/i18n";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { saveFile } from "@/lib/desktop";
import { bytesToBase64 } from "@/utils/base64";
import { formatBytes } from "@/utils/format-bytes";
import {
  bytesToHex,
  compressBytes,
  decodeUtf8,
  decompress,
  FORMAT_EXTENSIONS,
  FORMAT_LABELS,
  gzipOriginalName,
  hexPreview,
  parseEncodedInput,
  ratioLabel,
  type CompressionFormat,
} from "@/utils/compression";

type Mode = "decompress" | "compress";
type Encoding = "base64" | "hex";

interface OpenedFile {
  name: string;
  bytes: Uint8Array;
}

interface Decompressed {
  input: Uint8Array;
  output: Uint8Array;
  format: CompressionFormat;
  text: string | null;
  /** What the notice says: how the format was found and where the data came from. */
  how: "detected" | "readAs" | "noHeader";
  source: "file" | "twice" | "hex" | "base64";
  /** The name of the opened file, or the name stored in a gzip header. */
  fileName?: string;
  storedName?: string;
}

const HEX_PREVIEW_BYTES = 4096;
const FORMATS: CompressionFormat[] = ["gzip", "deflate", "deflate-raw"];
const TAB_LABELS: Record<CompressionFormat, string> = { gzip: "GZIP", deflate: "zlib", "deflate-raw": "Raw deflate" };

const readFileBytes = (file: File): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error(tNow("error.readFile")));
    reader.readAsArrayBuffer(file);
  });

const FAQ_KEYS = ["input", "helm", "notText", "bigger", "limit", "upload"] as const;

/** The name to save decompressed data under: the gzip header name, the file name without its extension, or a default. */
const decompressedName = (result: Decompressed, file: OpenedFile | null) => {
  const stored = result.format === "gzip" ? gzipOriginalName(result.input) : undefined;
  if (stored) return stored;
  const base = file?.name.replace(/\.(gz|gzip|tgz|z|zz|zlib|deflate)$/i, "");
  if (base && base !== file?.name) return base;
  return result.text === null ? "decompressed.bin" : "decompressed.txt";
};

export function Compression() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("decompress");
  const [encodedInput, setEncodedInput] = useState("");
  const [file, setFile] = useState<OpenedFile | null>(null);
  const [readFormat, setReadFormat] = useState<CompressionFormat | "auto">("auto");
  const [textToCompress, setTextToCompress] = useState("");
  const [writeFormat, setWriteFormat] = useState<CompressionFormat>("gzip");
  const [encoding, setEncoding] = useState<Encoding>("base64");
  const [decompressed, setDecompressed] = useState<Decompressed | null>(null);
  const [decompressError, setDecompressError] = useState("");
  const [compressed, setCompressed] = useState<Uint8Array | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pendingInput = useDebouncedValue(encodedInput);
  const pendingText = useDebouncedValue(textToCompress);

  useEffect(() => {
    let current = true;
    const run = async () => {
      if (!file && !pendingInput.trim()) {
        setDecompressed(null);
        setDecompressError("");
        return;
      }
      try {
        const parsed = file ? null : parseEncodedInput(pendingInput);
        const input = file ? file.bytes : parsed!.bytes;
        const result = await decompress(input, readFormat);
        if (!current) return;
        const source = file ? "file" : parsed!.nested ? "twice" : parsed!.encoding === "hex" ? "hex" : "base64";
        const how = readFormat !== "auto" ? "readAs" : result.format === "deflate-raw" ? "noHeader" : "detected";
        const stored = result.format === "gzip" ? gzipOriginalName(input) : undefined;
        setDecompressed({
          input,
          output: result.bytes,
          format: result.format,
          text: decodeUtf8(result.bytes),
          how,
          source,
          fileName: file?.name,
          storedName: stored,
        });
        setDecompressError("");
      } catch (err) {
        if (!current) return;
        setDecompressed(null);
        setDecompressError((err as Error).message);
      }
    };
    void run();
    return () => {
      current = false;
    };
  }, [file, pendingInput, readFormat, t]);

  useEffect(() => {
    let current = true;
    if (!pendingText) {
      setCompressed(null);
      return;
    }
    compressBytes(new TextEncoder().encode(pendingText), writeFormat).then(
      (bytes) => current && setCompressed(bytes),
      () => current && setCompressed(null),
    );
    return () => {
      current = false;
    };
  }, [pendingText, writeFormat]);

  const compressedOutput = useMemo(() => {
    if (!compressed) return "";
    return encoding === "hex" ? bytesToHex(compressed) : bytesToBase64(compressed);
  }, [compressed, encoding]);

  const openFile = async (picked: File | undefined) => {
    if (!picked) return;
    try {
      setFile({ name: picked.name, bytes: await readFileBytes(picked) });
    } catch {
      toast.error(t("toast.readFailed"));
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
    void openFile(event.dataTransfer.files[0]);
  };

  const save = async (bytes: Uint8Array, fileName: string, type: string) => {
    try {
      if (await saveFile(new Blob([bytes as BlobPart], { type }), fileName)) toast.success(t("toast.saved", { name: fileName }));
    } catch (err) {
      toast.error((err as Error).message || t("toast.saveFailed"));
    }
  };

  // Move the result into the other direction's input
  const swap = () => {
    if (mode === "compress") {
      setFile(null);
      setEncodedInput(compressedOutput);
      setMode("decompress");
    } else if (decompressed?.text != null) {
      setTextToCompress(decompressed.text);
      setWriteFormat(decompressed.format);
      setMode("compress");
    }
  };

  const decompressing = mode === "decompress";
  const canSwap = decompressing ? decompressed?.text != null : Boolean(compressedOutput);
  const binaryTruncated = decompressed?.text === null && decompressed.output.length > HEX_PREVIEW_BYTES;

  const status = () => {
    if (decompressing) {
      if (decompressError) return <span className="text-destructive">{t("status.invalid")}</span>;
      if (!decompressed) return <span>{t("status.ready")}</span>;
      const { input, output } = decompressed;
      return <span>{t("status.decompressed", { input: formatBytes(input.length), output: formatBytes(output.length), ratio: ratioLabel(input.length, output.length) })}</span>;
    }
    if (!compressed) return <span>{t("status.ready")}</span>;
    const original = new TextEncoder().encode(pendingText).length;
    return <span>{t("status.compressed", { original: formatBytes(original), compressed: formatBytes(compressed.length), ratio: ratioLabel(compressed.length, original) })}</span>;
  };

  const notice = () => {
    if (!decompressing) return undefined;
    if (decompressError) return <div className="workspace-notice" data-tone="error" role="alert">{decompressError}</div>;
    if (!decompressed) return undefined;
    const format = FORMAT_LABELS[decompressed.format];
    const lead = t(`notice.${decompressed.how}.${decompressed.source}`, { format, name: decompressed.fileName ?? "" });
    const stored = decompressed.storedName ? ` ${t("notice.originalName", { name: decompressed.storedName })}` : "";
    const tail = binaryTruncated ? ` ${t("notice.binary", { size: formatBytes(decompressed.output.length) })}` : "";
    return <div className="workspace-notice" role="status">{lead}{stored}{tail}</div>;
  };

  return (
    <ToolWorkspace
      id="compression"
      toolbar={
        <>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList aria-label={t("mode.label")}>
              <TabsTrigger value="decompress">{t("mode.decompress")}</TabsTrigger>
              <TabsTrigger value="compress">{t("mode.compress")}</TabsTrigger>
            </TabsList>
          </Tabs>
          {decompressing ? (
            <Tabs value={readFormat} onValueChange={(v) => setReadFormat(v as CompressionFormat | "auto")} className="indent-control">
              <TabsList aria-label={t("format.label")}>
                <TabsTrigger value="auto">{t("format.auto")}</TabsTrigger>
                {FORMATS.map((f) => <TabsTrigger key={f} value={f}>{TAB_LABELS[f]}</TabsTrigger>)}
              </TabsList>
            </Tabs>
          ) : (
            <>
              <Tabs value={writeFormat} onValueChange={(v) => setWriteFormat(v as CompressionFormat)} className="indent-control">
                <TabsList aria-label={t("format.label")}>
                  {FORMATS.map((f) => <TabsTrigger key={f} value={f}>{TAB_LABELS[f]}</TabsTrigger>)}
                </TabsList>
              </Tabs>
              <Tabs value={encoding} onValueChange={(v) => setEncoding(v as Encoding)}>
                <TabsList aria-label={t("encoding.label")}>
                  <TabsTrigger value="base64">Base64</TabsTrigger>
                  <TabsTrigger value="hex">{t("pane.hex")}</TabsTrigger>
                </TabsList>
              </Tabs>
            </>
          )}
          <button type="button" className="toolbar-text-button" onClick={swap} disabled={!canSwap}>
            {t("action.swap")}
          </button>
        </>
      }
      notice={notice()}
      first={
        decompressing ? (
          <EditorPane
            title={file ? t("pane.file") : t("pane.compressed")}
            htmlFor={file ? undefined : "compression-input"}
            scroll={Boolean(file)}
            actions={
              <>
                <input
                  ref={fileInputRef}
                  type="file"
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
                {(file || encodedInput) && (
                  <button type="button" className="toolbar-text-button" onClick={() => (file ? setFile(null) : setEncodedInput(""))}>
                    {t("common.clear")}
                  </button>
                )}
              </>
            }
          >
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
                    <FileArchive className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="truncate" dir="auto">{file.name}</span>
                    <span className="shrink-0 text-muted-foreground">{formatBytes(file.bytes.length)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("file.local")}</p>
                </div>
              ) : (
                <CodeTextarea
                  id="compression-input"
                  value={encodedInput}
                  onChange={(e) => setEncodedInput(e.target.value)}
                  placeholder={t("input.placeholder")}
                />
              )}
            </div>
          </EditorPane>
        ) : (
          <EditorPane
            title={t("pane.text")}
            htmlFor="compression-text"
            scroll={false}
            actions={textToCompress ? <button type="button" className="toolbar-text-button" onClick={() => setTextToCompress("")}>{t("common.clear")}</button> : undefined}
          >
            <CodeTextarea id="compression-text" value={textToCompress} onChange={(e) => setTextToCompress(e.target.value)} placeholder={t("text.placeholder")} />
          </EditorPane>
        )
      }
      second={
        decompressing ? (
          <EditorPane
            title={decompressed?.text === null ? t("pane.hex") : t("pane.text")}
            htmlFor={decompressed ? "compression-output" : undefined}
            scroll={false}
            actions={
              <>
                <CopyButton
                  value={decompressed ? decompressed.text ?? (binaryTruncated ? "" : hexPreview(decompressed.output)) : ""}
                  label={t("common.copy")}
                  ariaLabel={t("copy.decompressed")}
                />
                <button
                  type="button"
                  className="toolbar-text-button"
                  disabled={!decompressed}
                  onClick={() => decompressed && void save(decompressed.output, decompressedName(decompressed, file), "application/octet-stream")}
                >
                  <Download size={14} aria-hidden="true" />
                  {t("action.saveFile")}
                </button>
              </>
            }
          >
            {decompressed ? (
              <CodeTextarea
                id="compression-output"
                value={decompressed.text ?? hexPreview(decompressed.output, HEX_PREVIEW_BYTES)}
                readOnly
              />
            ) : (
              <PaneEmpty title={t("empty.decompressed")} hint={t("empty.decompressedHint")} />
            )}
          </EditorPane>
        ) : (
          <EditorPane
            title={encoding === "hex" ? "Hex" : "Base64"}
            htmlFor={compressedOutput ? "compression-output" : undefined}
            scroll={false}
            actions={
              <>
                <CopyButton value={compressedOutput} label={t("common.copy")} ariaLabel={t("copy.compressed")} />
                <button
                  type="button"
                  className="toolbar-text-button"
                  disabled={!compressed}
                  onClick={() => compressed && void save(compressed, `compressed.${FORMAT_EXTENSIONS[writeFormat]}`, writeFormat === "gzip" ? "application/gzip" : "application/octet-stream")}
                >
                  <Download size={14} aria-hidden="true" />
                  {t("action.saveFile")}
                </button>
              </>
            }
          >
            {compressedOutput ? (
              <CodeTextarea id="compression-output" value={compressedOutput} readOnly />
            ) : (
              <PaneEmpty title={t("empty.compressed")} hint={t("empty.compressedHint")} />
            )}
          </EditorPane>
        )
      }
      status={status()}
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
