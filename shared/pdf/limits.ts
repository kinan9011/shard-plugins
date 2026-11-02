// Copied into each PDF plugin: isolated installations cannot import sibling packages.
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_SESSION_BYTES = 100 * 1024 * 1024;
export const MAX_PAGES = 500;
export const MAX_IMAGE_PIXELS = 32_000_000;

export function inputKind(bytes: Uint8Array): "pdf" | "png" | "jpeg" {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error("Choose a non-empty file up to 50 MiB.");
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (header.includes("%PDF-")) return "pdf";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  throw new Error("Unsupported file. Choose a PDF, PNG or JPEG; renaming a file does not convert it.");
}

export function checkImageSize(width: number, height: number) {
  if (width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS) {
    throw new Error("Images must have valid dimensions and no more than 32 million pixels.");
  }
}

/** Check dimensions before asking a decoder to allocate pixels. */
export function imageSize(bytes: Uint8Array, kind: "png" | "jpeg") {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (kind === "png" && bytes.length >= 24) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (kind === "jpeg") {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  }
  checkImageSize(width, height);
  return { width, height };
}

/** Commas join pages; semicolons separate output PDFs. Order and duplicates are intentional. */
export function parseRanges(value: string, count: number): number[][] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PAGES) throw new Error("No valid pages to split.");
  if (value.length > 5000) throw new Error("Page ranges are too long.");
  let total = 0;
  return value.split(";").map(group => {
    const pages: number[] = [];
    for (const token of group.split(",")) {
      const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token.trim());
      if (!match) throw new Error("Use page ranges such as 1-3,5;6-8.");
      const start = Number(match[1]), end = Number(match[2] ?? match[1]);
      if (start < 1 || end < start || end > count) throw new Error(`Ranges must be ascending, between 1 and ${count}.`);
      for (let page = start; page <= end; page++) {
        if (++total > MAX_PAGES) throw new Error("Export at most 500 pages at a time.");
        pages.push(page - 1);
      }
    }
    return pages;
  });
}

export function everyNPages(count: number, size: number): number[][] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PAGES || !Number.isInteger(size) || size < 1 || size > MAX_PAGES) {
    throw new Error("Choose a whole number between 1 and 500.");
  }
  return Array.from({ length: Math.ceil(count / size) }, (_, group) =>
    Array.from({ length: Math.min(size, count - group * size) }, (_, i) => group * size + i));
}
