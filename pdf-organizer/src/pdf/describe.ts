import { t, type TKey, type TVars } from "@/lib/i18n";
import { CodedError } from "./errors";

/** limits.ts is a shared file that throws plain English messages; they are matched here so the page can show them in the app language. */
const LIMITS: [RegExp, TKey, ((match: RegExpMatchArray) => TVars)?][] = [
  [/^Choose a non-empty file up to 50 MiB\.$/, "limit.file"],
  [/^Unsupported file\. Choose a PDF, PNG or JPEG; renaming a file does not convert it\.$/, "limit.unsupported"],
  [/^Images must have valid dimensions and no more than 32 million pixels\.$/, "limit.image"],
  [/^No valid pages to split\.$/, "limit.noPages"],
  [/^Page ranges are too long\.$/, "limit.rangesLong"],
  [/^Use page ranges such as 1-3,5;6-8\.$/, "limit.rangesSyntax"],
  [/^Ranges must be ascending, between 1 and (\d+)\.$/, "limit.rangesBounds", (match) => ({ count: match[1] })],
  [/^Export at most 500 pages at a time\.$/, "limit.exportMax"],
  [/^Choose a whole number between 1 and 500\.$/, "limit.wholeNumber"],
];

/** The message of an error in the current language. Call it when the message is shown, not when the error is created. */
export function describeError(error: unknown): string {
  if (error instanceof CodedError) return t(error.key, error.vars);
  if (!(error instanceof Error)) return t("error.generic");
  for (const [pattern, key, vars] of LIMITS) {
    const match = pattern.exec(error.message);
    if (match) return t(key, vars?.(match));
  }
  return error.message;
}
