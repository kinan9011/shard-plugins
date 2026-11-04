import { formatNumber } from "@/lib/i18n";

/**
 * Format a byte count for display. Units (B, KB, MB, GB) stay as they are; the decimal mark follows the app language.
 */
export function formatBytes(size: number): string {
  if (size < 1024) return `${formatNumber(size, { useGrouping: false })} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = value >= 10 ? 1 : 2;
  return `${formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })} ${units[i]}`;
}
