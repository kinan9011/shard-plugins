import { t } from "./lib/i18n";

export type BuilderMode =
  "every" | "specific" | "range" | "interval" | "custom";
export function cronFieldValue(
  mode: BuilderMode,
  first: string,
  second: string,
): string {
  if (mode === "every") return "*";
  if (mode === "custom") return first;
  const valid =
    mode === "specific"
      ? /^\d+(?:,\d+)*$/.test(first)
      : /^\d+$/.test(first) && /^\d+$/.test(second);
  if (!valid)
    throw new Error(t("cron.builder.error.numbers"));
  if (mode === "range" && Number(first) > Number(second))
    throw new Error(t("cron.builder.error.rangeOrder"));
  if (mode === "interval" && Number(second) < 1)
    throw new Error(t("cron.builder.error.intervalMin"));
  return mode === "specific"
    ? first
    : mode === "range"
      ? `${first}-${second}`
      : `${first}/${second}`;
}
