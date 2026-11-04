import { formatNumber } from "@/lib/i18n";

/**
 * Format a byte count for display
 */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
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
