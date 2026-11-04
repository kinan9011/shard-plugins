import { formatNumber, t, type TKey } from "@/lib/i18n";
import type { FindingKind, MetadataFinding } from "@/utils/image-metadata";
import type { Patch } from "@/utils/byte-source";

export type VideoFormat = "mp4" | "mov" | "m4v" | "3gp" | "mkv" | "webm";

export interface VideoCleanOptions {
  /** Set the creation and modification dates in the movie, track, and segment headers to zero. */
  clearDates: boolean;
  /** Remove timed metadata tracks (GoPro telemetry, camera motion, face detection) and zero their samples. */
  removeMetadataTracks: boolean;
  /** Keep fonts attached to a Matroska file, because subtitles need them. */
  keepFonts: boolean;
}

export const DEFAULT_VIDEO_OPTIONS: VideoCleanOptions = { clearDates: true, removeMetadataTracks: true, keepFonts: true };

export interface ScanResult {
  format: VideoFormat;
  findings: MetadataFinding[];
  /** The changes that make the clean copy with the options of the scan. */
  patches: Patch[];
  /** Parts of the file the scan could not check. */
  warnings: string[];
}

export class VideoError extends Error {
  /** True for a damaged element that the scan can report as a warning and step over, instead of failing. */
  soft: boolean;
  constructor(message: string, soft = false) {
    super(message);
    this.soft = soft;
  }
}

/** saveFile in the desktop app holds the whole file in memory, so the tool sets a limit. */
export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;

export const VIDEO_FORMAT_LABELS: Record<VideoFormat, string> = { mp4: "MP4", mov: "MOV", m4v: "M4V", "3gp": "3GP", mkv: "MKV", webm: "WebM" };

export const VIDEO_MIME: Record<VideoFormat, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  "3gp": "video/3gpp",
  mkv: "video/x-matroska",
  webm: "video/webm",
};

export const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/x-m4v,video/3gpp,video/3gpp2,video/x-matroska,video/webm,.mp4,.mov,.qt,.m4v,.3gp,.3g2,.mkv,.webm";

/** Labels for metadata keys that QuickTime, Android, and FFmpeg write in MP4, MOV, and Matroska files. */
const NAMED_KEYS: Record<string, [TKey, FindingKind]> = {
  title: ["label.title", "text"],
  comment: ["label.comment", "text"],
  description: ["label.description", "text"],
  location: ["label.gpsPosition", "location"],
  "location.iso6709": ["label.gpsPosition", "location"],
  "location.name": ["label.locationName", "location"],
  make: ["label.cameraMake", "camera"],
  model: ["label.cameraModel", "camera"],
  software: ["label.software", "other"],
  encoder: ["label.encoder", "other"],
  creationdate: ["label.creationDate", "camera"],
  creation_time: ["label.creationDate", "camera"],
  date: ["label.creationDate", "camera"],
  author: ["label.author", "provenance"],
  artist: ["label.artist", "provenance"],
  copyright: ["label.copyright", "provenance"],
  "content.identifier": ["label.contentIdentifier", "other"],
  "com.android.version": ["label.androidVersion", "camera"],
  "com.android.capture.fps": ["label.captureFps", "camera"],
};

/** The label and kind of a known metadata key. Ignores case, the "com.apple.quicktime." prefix, and a language suffix such as "-eng". */
export const namedKey = (key: string): [string, FindingKind] | undefined => {
  const named = NAMED_KEYS[key.toLowerCase().replace(/^com\.apple\.quicktime\./, "").replace(/-[a-z]{3}$/, "")];
  return named && [t(named[0]), named[1]];
};

/** Writes "+37.3349-122.0090+010.000/" as "37.3349, -122.009". Other text stays as it is. */
export function iso6709(text: string): string {
  const match = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(text.trim());
  return match ? `${Number(match[1])}, ${Number(match[2])}` : text;
}

const KNOWN_EXTENSIONS = new Set(["mp4", "mov", "qt", "m4v", "3gp", "3g2", "mkv", "webm"]);

/** Builds "<name>-clean.<ext>". Keeps the original extension when it is a video extension. */
export function cleanVideoName(name: string, format: VideoFormat): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name) || "video";
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  return `${base}-clean.${KNOWN_EXTENSIONS.has(ext.toLowerCase()) ? ext : format}`;
}

/** "12 bytes" in the current language. */
export const bytesText = (count: number) => t("detail.bytes", { count, number: formatNumber(count) });
