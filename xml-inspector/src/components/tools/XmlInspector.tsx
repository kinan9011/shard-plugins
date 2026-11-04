import { useEffect, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Input } from "@/components/ui/input";
import { inspectXml, parseXml } from "@/utils/xml-inspector";
import { formatCode } from "@/utils/code-formatter";
import { saveFile } from "@/lib/desktop";
import { autoDir, formatNumber, useT } from "@/lib/i18n";
import { CopyButton } from "./CopyButton";
import {
  CodeTextarea,
  EditorPane,
  PaneEmpty,
  ToolWorkspace,
} from "./ToolWorkspace";
export function XmlInspector() {
  const t = useT();
  const [input, setInput] = useState("");
  const [xpath, setXpath] = useState("");
  const [namespaces, setNamespaces] = useState("");
  const [mode, setMode] = useState("beautify");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const text = useDebouncedValue(input),
    query = useDebouncedValue(xpath),
    ns = useDebouncedValue(namespaces);
  useEffect(() => {
    let cancelled = false;
    setError("");
    setOutput("");
    if (!text.trim()) {
      setPending(false);
      return;
    }
    setPending(true);
    (async () => {
      // Parse once: XPath queries the parsed document, and the formatter needs only the check.
      const document = parseXml(text);
      const value =
        mode === "xpath"
          ? inspectXml(document, query, ns)
          : await formatCode(text, {
              language: "xml",
              mode: mode as "beautify" | "minify",
              indent: "2",
            });
      if (!cancelled) setOutput(value);
    })()
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setPending(false));
    return () => {
      cancelled = true;
    };
  }, [text, query, ns, mode, t]);
  return (
    <ToolWorkspace
      wrapToolbar
      id="xml-inspector"
      toolbar={
        <>
          <label>
            {t("mode.label")}{" "}
            <select
              className="h-8 rounded-md border border-input bg-background px-2 pe-7 text-sm text-foreground"
              aria-label={t("mode.aria")}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="beautify">{t("mode.format")}</option>
              <option value="minify">{t("mode.minify")}</option>
              <option value="xpath">XPath</option>
            </select>
          </label>
          <button
            className="toolbar-text-button"
            onClick={() =>
              setInput(
                '<root><item id="1">Hello</item><item id="2">World</item></root>',
              )
            }
          >
            {t("action.example")}
          </button>
        </>
      }
      secondaryToolbar={
        mode === "xpath" && (
          <div className="flex flex-wrap gap-3 w-full">
            <Input
              aria-label={t("xpath.label")}
              className="flex-1 min-w-48 font-mono"
              placeholder={t("xpath.placeholder")}
              value={xpath}
              onChange={(e) => setXpath(e.target.value)}
            />
            <textarea
              className="rounded-md border bg-background px-3 py-2 text-sm font-mono"
              dir={autoDir(namespaces)}
              aria-label={t("namespaces.label")}
              placeholder={t("namespaces.placeholder")}
              value={namespaces}
              onChange={(e) => setNamespaces(e.target.value)}
            />
          </div>
        )
      }
      notice={
        error && (
          <div className="workspace-notice" data-tone="error" role="alert">
            {error}
          </div>
        )
      }
      first={
        <EditorPane title={t("pane.xml")} htmlFor="xml-input" scroll={false}>
          <CodeTextarea
            id="xml-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("input.placeholder")}
          />
        </EditorPane>
      }
      second={
        <EditorPane
          title={t("pane.result")}
          actions={
            <>
              <CopyButton value={output} />
              <button
                className="toolbar-text-button"
                disabled={!output}
                onClick={async () => {
                  try {
                    await saveFile(
                      new Blob([output], { type: "text/plain" }),
                      mode === "xpath" ? "xpath-result.txt" : "formatted.xml",
                    );
                  } catch {
                    setError(t("error.save"));
                  }
                }}
              >
                {t("common.save")}
              </button>
            </>
          }
        >
          {pending ? (
            <PaneEmpty title={t("empty.processing")} />
          ) : output ? (
            <pre dir="ltr" className="p-4 font-mono text-sm whitespace-pre-wrap break-all">
              {output}
            </pre>
          ) : (
            <PaneEmpty
              title={error ? t("empty.checkTitle") : t("empty.title")}
              hint={t("empty.hint")}
            />
          )}
        </EditorPane>
      }
      status={
        <span>{t("status.chars", { count: input.length, n: formatNumber(input.length) })}</span>
      }
    />
  );
}
