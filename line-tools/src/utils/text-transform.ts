import { formatNumber, t } from "@/lib/i18n";
import { splitLines } from "./line-tools";
export type TextTransform =
  "split" | "join" | "wrap" | "replace" | "regex" | "sum" | "product";
export interface TransformOptions {
  operation: TextTransform;
  first: string;
  second: string;
}
export const DEFAULT_TRANSFORM_OPTIONS: TransformOptions = {
  operation: "split",
  first: ",",
  second: "",
};
export function transformText(
  input: string,
  operation: TextTransform,
  first = "",
  second = "",
): string {
  if (input.length > 200000)
    throw new Error(t("error.tooLong", { limit: formatNumber(200000) }));
  const maxOutput = 2_000_000;
  // A final line break ends the last line. It does not start an empty line.
  const { lines, eol, trailingNewline } = splitLines(input);
  const lineCount = lines.length;
  const expansion =
    operation === "wrap"
      ? input.length + lineCount * (first.length + second.length)
      : operation === "join"
        ? input.length + lineCount * first.length
        : operation === "replace" && first
          ? input.length +
            Math.floor(input.length / first.length) * second.length
          : input.length;
  if (expansion > maxOutput)
    throw new Error(t("error.outputTooLarge"));
  switch (operation) {
    case "split":
      if (!first) throw new Error(t("error.enterSeparator"));
      return input.split(first).join("\n");
    case "join":
      return lines.join(first);
    case "wrap":
      return (
        lines.map((line) => first + line + second).join(eol) +
        (trailingNewline ? eol : "")
      );
    case "replace":
      if (!first) throw new Error(t("error.enterFind"));
      return input.split(first).join(second);
    case "regex":
      throw new Error(t("error.regexWorker"));
    case "sum":
    case "product": {
      const values = lines
        .filter((line) => line.trim())
        .map((line) => {
          if (
            !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(line.trim())
          )
            throw new Error(t("error.notNumber", { line }));
          const n = Number(line);
          if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER)
            throw new Error(t("error.numberRange"));
          return n;
        });
      if (!values.length) throw new Error(t("error.enterNumbers"));
      const value = values.reduce(
        (a, b) => (operation === "sum" ? a + b : a * b),
        operation === "sum" ? 0 : 1,
      );
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
        throw new Error(t("error.resultRange"));
      return String(value);
    }
  }
}
