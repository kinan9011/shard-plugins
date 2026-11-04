export type Color = "color" | "gray" | "bw";
export type Options = {
  mode: "optimize" | "raster";
  dpi: number;
  quality: number;
  color: Color;
  threshold: number;
  flattenForms: boolean;
  removeMetadata: boolean;
  removeExtras: boolean;
};

export const PRESETS = {
  gentle: { mode: "optimize", dpi: 150, quality: 85 },
  balanced: { mode: "raster", dpi: 150, quality: 78 },
  strong: { mode: "raster", dpi: 100, quality: 60 },
  extreme: { mode: "raster", dpi: 72, quality: 40 },
} as const;
export type Preset = keyof typeof PRESETS | "custom";
export const DEFAULT_OPTIONS: Options = { ...PRESETS.gentle, color: "color", threshold: 160, flattenForms: false, removeMetadata: true, removeExtras: false };
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_PAGES = 500;
export const MAX_PIXELS = 12_000_000;

export function validateOptions(o: Options) {
  if (!["optimize", "raster"].includes(o.mode) || !["color", "gray", "bw"].includes(o.color) ||
    !Number.isInteger(o.dpi) || o.dpi < 36 || o.dpi > 300 ||
    !Number.isInteger(o.quality) || o.quality < 10 || o.quality > 100 ||
    !Number.isInteger(o.threshold) || o.threshold < 1 || o.threshold > 254 ||
    [o.flattenForms, o.removeMetadata, o.removeExtras].some(value => typeof value !== "boolean") ||
    (o.mode === "optimize" && o.color !== "color")) throw new Error("error.options");
}

export function rasterSize(width: number, height: number, dpi: number) {
  if (![width, height, dpi].every(Number.isFinite) || width <= 0 || height <= 0 || dpi < 36 || dpi > 300) throw new Error("error.dimensions");
  const scale = dpi / 72;
  const w = Math.ceil(width * dpi / 72), h = Math.ceil(height * dpi / 72);
  if (w * h > MAX_PIXELS || w > 16384 || h > 16384) throw new Error("error.pixels");
  return { width: w, height: h, scale };
}

/** White = 1, black = 0; each scanline is padded to a whole byte. */
export function monochrome(rgba: Uint8ClampedArray, width: number, height: number, threshold: number) {
  const stride = Math.ceil(width / 8);
  const packed = new Uint8Array(stride * height).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const value = (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) * (rgba[at + 3] / 255) + 255 - rgba[at + 3];
    if (value < threshold) packed[y * stride + (x >> 3)] &= ~(128 >> (x & 7));
  }
  return packed;
}
