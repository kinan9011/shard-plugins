import { ImageEditor } from "./ImageEditor";
import { ImagePaletteControls } from "./ImagePaletteControls";
import { ImageResizeControls } from "./ImageResizeControls";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { zipSync } from "fflate";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  ImageIcon as ImageIconLucide,
  Images,
  LoaderCircle,
  Upload,
} from "lucide-react";
import { toast } from "@/shims/sonner";
import { saveFile } from "@/lib/desktop";
import { formatNumber, t as tNow, useT } from "@/lib/i18n";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { canvasPixels, processWasm } from "@/utils/image-reencode";
import {
  buildOutputFilename,
  DEFAULT_PALETTE,
  DEFAULT_RESIZE,
  formatSavingsLabel,
  formatFileSize,
  getEffectiveOutputFormat,
  getFormatLabel,
  getMimeTypeFromFormat,
  getSavingsPercent,
  isSupportedImageType,
  resizeTarget,
  shouldShowQualityControl,
  SUPPORTED_IMAGE_TYPES,
  type CompressionTarget,
  type ImageFormat,
  type PaletteSettings,
  type ResizeSettings,
} from "@/utils/image";

interface ProcessedImage {
  blob: Blob;
  bytes: Uint8Array;
  format: ImageFormat;
  width: number;
  height: number;
}

interface SingleCompressionResult extends ProcessedImage {
  previewUrl: string;
}

interface BulkCompressionResult {
  id: string;
  name: string;
  originalSize: number;
  status: "pending" | "processing" | "done" | "error";
  compressedSize?: number;
  savingsPercent?: number;
  format?: ImageFormat;
  blob?: Blob;
  bytes?: Uint8Array;
  error?: string;
}

const ACCEPTED_IMAGE_TYPES = SUPPORTED_IMAGE_TYPES.join(",");

function getFileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function getProcessingErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : tNow("error.process");
}

function getUniqueFileName(fileName: string, usedNames: Map<string, number>): string {
  const currentCount = usedNames.get(fileName) ?? 0;
  usedNames.set(fileName, currentCount + 1);

  if (currentCount === 0) {
    return fileName;
  }

  const extensionIndex = fileName.lastIndexOf(".");
  const baseName = extensionIndex === -1 ? fileName : fileName.slice(0, extensionIndex);
  const extension = extensionIndex === -1 ? "" : fileName.slice(extensionIndex);

  return `${baseName}-${currentCount + 1}${extension}`;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(tNow("error.load", { name: file.name })));
    };

    image.src = objectUrl;
  });
}

async function compressImage(
  file: File,
  target: CompressionTarget,
  quality: number,
  resize: ResizeSettings = DEFAULT_RESIZE,
  palette: PaletteSettings = DEFAULT_PALETTE,
): Promise<ProcessedImage> {
  const outputFormat = getEffectiveOutputFormat(file.type, target);

  if (!outputFormat) {
    throw new Error(tNow("error.unsupportedFormat"));
  }

  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error(tNow("error.canvasBrowser"));
  }

  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;

  if (outputFormat === "jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(image, 0, 0);

  // Every format uses a WASM encoder: MozJPEG, OxiPNG, WebP, or AVIF. They write smaller files than
  // the browser encoders, and the macOS web view cannot write WebP at all.
  const size = resizeTarget(canvas.width, canvas.height, resize);
  let result;
  try {
    result = await processWasm(canvasPixels(canvas), {
      format: outputFormat,
      quality,
      resize: size
        ? { ...size, method: resize.method, premultiply: resize.premultiply, linearRgb: resize.linearRgb }
        : undefined,
      palette: palette.enabled ? { colors: palette.colors, dither: palette.dither } : undefined,
    });
  } catch {
    throw new Error(tNow("error.compress", { name: file.name }));
  }
  const blob = new Blob([result.bytes.slice()], { type: getMimeTypeFromFormat(outputFormat) });

  return {
    blob,
    bytes: result.bytes,
    format: outputFormat,
    width: result.width,
    height: result.height,
  };
}

function StatsCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-base font-semibold leading-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const TARGETS: CompressionTarget[] = ["original", "jpeg", "png", "webp", "avif"];

export function ImageConverter() {
  const t = useT();
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [singleTarget, setSingleTarget] = useState<CompressionTarget>("original");
  const [singleQuality, setSingleQuality] = useState([82]);
  const [singleResize, setSingleResize] = useState<ResizeSettings>(DEFAULT_RESIZE);
  const [singlePalette, setSinglePalette] = useState<PaletteSettings>(DEFAULT_PALETTE);
  const [singleSource, setSingleSource] = useState<{ width: number; height: number } | null>(null);
  const [singleOriginalPreviewUrl, setSingleOriginalPreviewUrl] = useState<string | null>(null);
  const [singleResult, setSingleResult] = useState<SingleCompressionResult | null>(null);
  const [singleProcessing, setSingleProcessing] = useState(false);
  const [singleError, setSingleError] = useState<string | null>(null);

  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkTarget, setBulkTarget] = useState<CompressionTarget>("original");
  const [bulkQuality, setBulkQuality] = useState([82]);
  const [bulkResize, setBulkResize] = useState<ResizeSettings>(DEFAULT_RESIZE);
  const [bulkPalette, setBulkPalette] = useState<PaletteSettings>(DEFAULT_PALETTE);
  const [bulkResults, setBulkResults] = useState<BulkCompressionResult[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkCompletedCount, setBulkCompletedCount] = useState(0);
  const singleInputRef = useRef<HTMLInputElement>(null);
  const bulkInputRef = useRef<HTMLInputElement>(null);
  // Typing a width or dragging the color slider runs the encoder once the value settles.
  const singleResizeSettled = useDebouncedValue(singleResize, 300);
  const bulkResizeSettled = useDebouncedValue(bulkResize, 300);
  const singlePaletteSettled = useDebouncedValue(singlePalette, 300);
  const bulkPaletteSettled = useDebouncedValue(bulkPalette, 300);

  useEffect(() => {
    let cancelled = false;
    setSingleSource(null);
    // A custom size belongs to the previous image, so a new image starts from the percent.
    setSingleResize((previous) =>
      previous.width === null && previous.height === null ? previous : { ...previous, width: null, height: null },
    );
    if (singleFile) {
      loadImage(singleFile)
        .then((image) => {
          if (!cancelled) setSingleSource({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [singleFile]);

  useEffect(() => {
    if (!singleFile) {
      setSingleOriginalPreviewUrl(null);
      return undefined;
    }

    const previewUrl = URL.createObjectURL(singleFile);
    setSingleOriginalPreviewUrl(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [singleFile]);

  useEffect(() => {
    let cancelled = false;
    let previewUrl: string | null = null;

    if (!singleFile) {
      setSingleResult(null);
      setSingleError(null);
      setSingleProcessing(false);
      return undefined;
    }

    setSingleProcessing(true);
    setSingleError(null);
    setSingleResult(null);

    compressImage(singleFile, singleTarget, singleQuality[0], singleResizeSettled, singlePaletteSettled)
      .then((result) => {
        if (cancelled) {
          return;
        }

        previewUrl = URL.createObjectURL(result.blob);
        setSingleResult({ ...result, previewUrl });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSingleError(getProcessingErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setSingleProcessing(false);
        }
      });

    return () => {
      cancelled = true;

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [singleFile, singleQuality, singleTarget, singleResizeSettled, singlePaletteSettled]);

  useEffect(() => {
    let cancelled = false;

    if (bulkFiles.length === 0) {
      setBulkResults([]);
      setBulkCompletedCount(0);
      setBulkProcessing(false);
      return undefined;
    }

    const initialResults: BulkCompressionResult[] = bulkFiles.map((file) => ({
      id: getFileId(file),
      name: file.name,
      originalSize: file.size,
      status: "pending" as const,
    }));

    setBulkResults(initialResults);
    setBulkCompletedCount(0);
    setBulkProcessing(true);

    const processFiles = async () => {
      const nextResults = [...initialResults];

      for (const [index, file] of bulkFiles.entries()) {
        if (cancelled) {
          return;
        }

        nextResults[index] = {
          ...nextResults[index],
          status: "processing",
        };
        setBulkResults([...nextResults]);

        try {
          const result = await compressImage(file, bulkTarget, bulkQuality[0], bulkResizeSettled, bulkPaletteSettled);

          if (cancelled) {
            return;
          }

          nextResults[index] = {
            ...nextResults[index],
            status: "done",
            blob: result.blob,
            bytes: result.bytes,
            compressedSize: result.blob.size,
            savingsPercent: getSavingsPercent(file.size, result.blob.size),
            format: result.format,
          };
        } catch (error) {
          if (cancelled) {
            return;
          }

          nextResults[index] = {
            ...nextResults[index],
            status: "error",
            error: getProcessingErrorMessage(error),
          };
        }

        setBulkCompletedCount(index + 1);
        setBulkResults([...nextResults]);
      }

      if (!cancelled) {
        setBulkProcessing(false);
      }
    };

    void processFiles();

    return () => {
      cancelled = true;
    };
  }, [bulkFiles, bulkQuality, bulkTarget, bulkResizeSettled, bulkPaletteSettled]);

  const handleSingleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!isSupportedImageType(file.type)) {
      toast.error(t("toast.chooseOne"));
      return;
    }

    setSingleFile(file);
  };

  const handleBulkUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    const supportedFiles = files.filter((file) => isSupportedImageType(file.type));

    if (supportedFiles.length === 0) {
      toast.error(t("toast.chooseMany"));
      return;
    }

    if (supportedFiles.length !== files.length) {
      toast.error(t("toast.skipped"));
    }

    setBulkFiles(supportedFiles);
  };

  const handleSingleDownload = async () => {
    if (!singleFile || !singleResult) {
      return;
    }

    try {
      const saved = await saveFile(
        singleResult.blob,
        buildOutputFilename(singleFile.name, singleResult.format),
      );
      if (saved) {
        toast.success(t("toast.downloaded"));
      }
    } catch (error) {
      console.error("Failed to save compressed image:", error);
      toast.error(t("toast.saveFailed"));
    }
  };

  const handleBulkDownload = async () => {
    const completedResults = bulkResults.filter(
      (result): result is BulkCompressionResult & { bytes: Uint8Array; format: ImageFormat } =>
        result.status === "done" && Boolean(result.bytes) && Boolean(result.format),
    );

    if (completedResults.length === 0) {
      return;
    }

    const usedNames = new Map<string, number>();
    const zipEntries = Object.fromEntries(
      completedResults.map((result) => [
        getUniqueFileName(buildOutputFilename(result.name, result.format), usedNames),
        result.bytes,
      ]),
    );

    const zipBlob = new Blob([new Uint8Array(zipSync(zipEntries, { level: 6 }))], {
      type: "application/zip",
    });

    try {
      if (await saveFile(zipBlob, "compressed-images.zip")) {
        toast.success(t("toast.zipReady"));
      }
    } catch (error) {
      console.error("Failed to save ZIP file:", error);
      toast.error(t("toast.zipFailed"));
    }
  };

  const bulkHasQualityControl = bulkFiles.some((file) =>
    shouldShowQualityControl(file.type, bulkTarget),
  );
  const completedBulkResults = bulkResults.filter((result) => result.status === "done");
  const totalBulkOriginalSize = completedBulkResults.reduce((sum, result) => sum + result.originalSize, 0);
  const totalBulkCompressedSize = completedBulkResults.reduce(
    (sum, result) => sum + (result.compressedSize ?? 0),
    0,
  );
  const totalBulkSavings =
    completedBulkResults.length > 0
      ? getSavingsPercent(totalBulkOriginalSize, totalBulkCompressedSize)
      : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("app.title")}</CardTitle>
          <CardDescription>
            {t("app.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs defaultValue="single" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="single">{t("tab.single")}</TabsTrigger>
              <TabsTrigger value="bulk">{t("tab.bulk")}</TabsTrigger>
              <TabsTrigger value="edit">{t("tab.edit")}</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="space-y-6">
              <input
                ref={singleInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                onChange={handleSingleUpload}
                className="hidden"
              />

              <Button
                onClick={() => singleInputRef.current?.click()}
                className="w-full"
                variant="outline"
              >
                <Upload className="me-2 h-4 w-4" />
                {t("action.uploadImage")}
              </Button>

              {!singleFile ? (
                <div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">
                  <ImageIconLucide className="mx-auto mb-4 h-12 w-12 opacity-50" />
                  <p>{t("empty.single")}</p>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px] lg:items-start">
                    <div className="space-y-2">
                      <Label>{t("label.original")}</Label>
                      <div className="rounded-lg bg-muted p-3">
                        {singleOriginalPreviewUrl ? (
                          <img
                            src={singleOriginalPreviewUrl}
                            alt={t("label.original")}
                            className="mx-auto max-h-64 w-auto max-w-full rounded-md"
                          />
                        ) : null}
                        <div className="mt-2 text-center text-sm text-muted-foreground">
                          {singleFile.name} • {formatFileSize(singleFile.size)}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>{t("label.compressedPreview")}</Label>
                      <div className="rounded-lg bg-muted p-3">
                        {singleProcessing ? (
                          <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
                            <LoaderCircle className="h-8 w-8 animate-spin" />
                            <p>{t("progress.compressing")}</p>
                          </div>
                        ) : singleError ? (
                          <div className="flex min-h-64 items-center justify-center text-center text-sm text-destructive">
                            {singleError}
                          </div>
                        ) : singleResult ? (
                          <>
                            <img
                              src={singleResult.previewUrl}
                              alt={t("alt.compressedPreview")}
                              className="mx-auto max-h-64 w-auto max-w-full rounded-md"
                            />
                            <div className="mt-2 text-center text-sm text-muted-foreground">
                              {getFormatLabel(singleResult.format)} •{" "}
                              {formatFileSize(singleResult.blob.size)}
                              <span
                                className={`ms-2 ${
                                  getSavingsPercent(singleFile.size, singleResult.blob.size) >= 0
                                    ? "text-success"
                                    : "text-warning"
                                }`}
                              >
                                (
                                {formatSavingsLabel(
                                  getSavingsPercent(singleFile.size, singleResult.blob.size),
                                )}
                                )
                              </span>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>{t("label.settings")}</Label>
                      <div className="space-y-4 rounded-lg bg-muted/50 p-4">
                        <div className="space-y-1.5">
                          <Label>{t("label.outputFormat")}</Label>
                          <Select
                            value={singleTarget}
                            onValueChange={(value) => setSingleTarget(value as CompressionTarget)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TARGETS.map((target) => (
                                <SelectItem key={target} value={target}>{t(`target.${target}`)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {shouldShowQualityControl(singleFile.type, singleTarget) ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <Label>{t("label.quality")}</Label>
                              <span className="text-sm text-muted-foreground">{singleQuality[0]}%</span>
                            </div>
                            <Slider
                              value={singleQuality}
                              onValueChange={setSingleQuality}
                              min={1}
                              max={100}
                              step={1}
                            />
                          </div>
                        ) : (
                          <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                            {t("note.png")}
                          </div>
                        )}

                        <ImageResizeControls
                          id="single"
                          value={singleResize}
                          onChange={setSingleResize}
                          source={singleSource}
                        />
                        <ImagePaletteControls id="single" value={singlePalette} onChange={setSinglePalette} />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <StatsCard
                      label={t("stats.originalSize")}
                      value={formatFileSize(singleFile.size)}
                      hint={singleFile.type.replace("image/", "").toUpperCase()}
                    />
                    <StatsCard
                      label={t("stats.compressedSize")}
                      value={singleResult ? formatFileSize(singleResult.blob.size) : t("stats.processing")}
                      hint={singleResult ? getFormatLabel(singleResult.format) : undefined}
                    />
                    <StatsCard
                      label={t("stats.savings")}
                      value={
                        singleResult
                          ? formatSavingsLabel(
                              getSavingsPercent(singleFile.size, singleResult.blob.size),
                            )
                          : t("stats.processing")
                      }
                      hint={singleResult ? `${singleResult.width} × ${singleResult.height}` : undefined}
                    />
                  </div>

                  <div className="flex justify-center">
                    <Button
                      onClick={handleSingleDownload}
                      className="sm:w-auto sm:min-w-[220px]"
                      size="lg"
                      disabled={!singleResult || singleProcessing}
                    >
                      <Download className="me-2 h-4 w-4" />
                      {t("action.downloadImage")}
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="bulk" className="space-y-6">
              <input
                ref={bulkInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                onChange={handleBulkUpload}
                className="hidden"
                multiple
              />

              <Button
                onClick={() => bulkInputRef.current?.click()}
                className="w-full"
                variant="outline"
              >
                <Images className="me-2 h-4 w-4" />
                {t("action.uploadImages")}
              </Button>

              {!bulkFiles.length ? (
                <div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">
                  <Images className="mx-auto mb-4 h-12 w-12 opacity-50" />
                  <p>{t("empty.bulk")}</p>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-3">
                    <StatsCard
                      label={t("stats.files")}
                      value={formatNumber(bulkFiles.length)}
                      hint={t("stats.processed", { count: bulkCompletedCount, n: formatNumber(bulkCompletedCount) })}
                    />
                    <StatsCard
                      label={t("stats.originalSize")}
                      value={formatFileSize(totalBulkOriginalSize)}
                      hint={t("stats.completedOnly")}
                    />
                    <StatsCard
                      label={t("stats.compressedSize")}
                      value={formatFileSize(totalBulkCompressedSize)}
                      hint={
                        completedBulkResults.length > 0 ? t("stats.smallerOverall", { percent: formatNumber(totalBulkSavings) }) : undefined
                      }
                    />
                  </div>

                  <div className="space-y-4 rounded-lg bg-muted/50 p-4">
                    <div className="space-y-2">
                      <Label>{t("label.bulkOutput")}</Label>
                      <Select
                        value={bulkTarget}
                        onValueChange={(value) => setBulkTarget(value as CompressionTarget)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGETS.map((target) => (
                            <SelectItem key={target} value={target}>{t(`target.${target}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {bulkHasQualityControl ? (
                      <div className="space-y-2">
                        <Label>{t("label.qualityValue", { value: bulkQuality[0] })}</Label>
                        <Slider
                          value={bulkQuality}
                          onValueChange={setBulkQuality}
                          min={1}
                          max={100}
                          step={1}
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("note.png")}
                      </p>
                    )}

                    <ImageResizeControls id="bulk" value={bulkResize} onChange={setBulkResize} />
                    <ImagePaletteControls id="bulk" value={bulkPalette} onChange={setBulkPalette} />

                    <Button
                      onClick={() => void handleBulkDownload()}
                      className="w-full"
                      size="lg"
                      disabled={completedBulkResults.length === 0 || bulkProcessing}
                    >
                      <Download className="me-2 h-4 w-4" />
                      {t("action.downloadZip")}
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>{t("label.results")}</Label>
                      {bulkProcessing ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          {t("progress.bulk", { done: formatNumber(bulkCompletedCount), total: formatNumber(bulkFiles.length) })}
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      {bulkResults.map((result) => (
                        <div
                          key={result.id}
                          className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">{result.name}</p>
                            <p dir="ltr" className="text-sm text-muted-foreground text-start">
                              {formatFileSize(result.originalSize)}
                              {result.compressedSize
                                ? ` -> ${formatFileSize(result.compressedSize)}`
                                : ""}
                            </p>
                            {result.error ? (
                              <p className="text-sm text-destructive">{result.error}</p>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {result.format ? <Badge variant="secondary">{getFormatLabel(result.format)}</Badge> : null}
                            {typeof result.savingsPercent === "number" ? (
                              <Badge variant={result.savingsPercent >= 0 ? "default" : "destructive"}>
                                {formatSavingsLabel(result.savingsPercent)}
                              </Badge>
                            ) : null}
                            <Badge variant="outline">
                              {t(`status.${result.status}`)}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
            <TabsContent value="edit"><ImageEditor /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("notes.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm md:grid-cols-2">
            <div>
              <dt className="font-medium">{t("notes.keep.title")}</dt>
              <dd className="text-muted-foreground">{t("notes.keep.body")}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("notes.webp.title")}</dt>
              <dd className="text-muted-foreground">{t("notes.webp.body")}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("notes.avif.title")}</dt>
              <dd className="text-muted-foreground">{t("notes.avif.body")}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("notes.png.title")}</dt>
              <dd className="text-muted-foreground">{t("notes.png.body")}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
