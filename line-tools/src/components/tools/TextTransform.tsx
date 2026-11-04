import { useEffect, useState, type ReactNode } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import {
  transformText,
  type TextTransform as Operation,
  type TransformOptions,
} from "@/utils/text-transform";
import { REGEX_TIMEOUT_MS, TIMEOUT_ERROR, runRegexInWorker } from "@/utils/regex-runner";
import {
  CodeTextarea,
  EditorPane,
  PaneEmpty,
  ToolWorkspace,
} from "./ToolWorkspace";
import { CopyButton } from "./CopyButton";
/** Line Tools owns the input and options, so they stay the same across its modes. */
export function TextTransform({
  navigation,
  input,
  onInputChange,
  options,
  onOptionsChange,
}: {
  navigation: ReactNode;
  input: string;
  onInputChange: (input: string) => void;
  options: TransformOptions;
  onOptionsChange: (options: TransformOptions) => void;
}) {
  const t = useT();
  const { operation, first, second } = options;
  const set = (patch: Partial<TransformOptions>) =>
    onOptionsChange({ ...options, ...patch });
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const text = useDebouncedValue(input),
    a = useDebouncedValue(first),
    b = useDebouncedValue(second);
  useEffect(() => {
    setOutput("");
    setError("");
    if (!text) return;
    if (operation !== "regex") {
      try {
        setOutput(transformText(text, operation, a, b));
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }
    // $` and $' insert the text before or after each match, so the output can grow with the square of the input.
    const perMatch = b.length + 1 + (/\$[`']/.test(b) ? text.length : 0);
    if (
      text.length > 200000 ||
      a.length > 10000 ||
      (text.length + 1) * perMatch > 2_000_000
    ) {
      setError(t("error.regexTooLarge"));
      return;
    }
    let cancelled = false;
    runRegexInWorker({
      pattern: a,
      flags: "g",
      text,
      replacement: b,
      limit: 0,
    }).then((result) => {
      // A null result means a newer run replaced this one.
      if (cancelled || !result) return;
      if ("error" in result) {
        // The worker answers in English: show its timeout and pattern errors in the app language.
        setError(
          result.error === TIMEOUT_ERROR
            ? t("error.regexTimeout", { seconds: REGEX_TIMEOUT_MS / 1000 })
            : result.reason !== undefined
              ? t("error.invalidPattern", { reason: result.reason })
              : result.error,
        );
      }
      else setOutput(result.replaced ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [text, operation, a, b, t]);
  return (
    <ToolWorkspace
      wrapToolbar
      id="line-tools"
      toolbar={
        <>
          {navigation}
          <select
            className="rounded-md border bg-background ps-2 pe-7 py-1 text-sm"
            aria-label={t("transform.label")}
            value={operation}
            onChange={(e) => set({ operation: e.target.value as Operation })}
          >
            {(
              [
                "split",
                "join",
                "wrap",
                "replace",
                "regex",
                "sum",
                "product",
              ] as const
            ).map((x) => (
              <option key={x} value={x}>
                {t(`transform.${x}`)}
              </option>
            ))}
          </select>
        </>
      }
      secondaryToolbar={
        !["sum", "product"].includes(operation) && (
          <>
            <Input
              className="max-w-72"
              aria-label={
                operation === "wrap"
                  ? t("transform.prefix")
                  : operation === "split" || operation === "join"
                    ? t("transform.separator")
                    : t("transform.find")
              }
              placeholder={
                operation === "wrap" ? t("transform.prefix") : t("transform.separatorOrPattern")
              }
              value={first}
              onChange={(e) => set({ first: e.target.value })}
            />
            {["wrap", "replace", "regex"].includes(operation) && (
              <Input
                className="max-w-72"
                aria-label={operation === "wrap" ? t("transform.suffix") : t("transform.replacement")}
                placeholder={operation === "wrap" ? t("transform.suffix") : t("transform.replacement")}
                value={second}
                onChange={(e) => set({ second: e.target.value })}
              />
            )}
          </>
        )
      }
      notice={
        error && (
          <p role="alert" className="workspace-notice" data-tone="error">
            {error}
          </p>
        )
      }
      first={
        <EditorPane title={t("pane.input")} htmlFor="transform-input">
          <CodeTextarea
            id="transform-input"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.result")} actions={<CopyButton value={output} />}>
          {output ? (
            <pre dir="ltr" className="p-4 whitespace-pre-wrap break-all font-mono text-sm">
              {output}
            </pre>
          ) : (
            <PaneEmpty title={error ? t("empty.checkInput") : t("empty.transform")} />
          )}
        </EditorPane>
      }
      status={
        <span>
          {operation === "sum" || operation === "product"
            ? t("status.numbers")
            : operation === "regex"
              ? t("status.regex", { seconds: REGEX_TIMEOUT_MS / 1000 })
              : t("status.apply")}
        </span>
      }
    />
  );
}
