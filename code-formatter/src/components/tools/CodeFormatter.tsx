import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { formatNumber, useT } from "@/lib/i18n";
import { formatBytes } from "@/utils/format-bytes";
import {
  formatCode,
  SqlParseError,
  type CodeLanguage,
  type FormatMode,
  type IndentChoice,
  type SqlDialect,
} from "@/utils/code-formatter";

const LANGUAGES: { value: CodeLanguage; label: string; placeholder: string }[] = [
  { value: "html", label: "HTML", placeholder: "<div><p>Hello</p><ul><li>One</li><li>Two</li></ul></div>" },
  { value: "css", label: "CSS", placeholder: ".card{color:red;margin:0 auto}.card:hover{color:blue}" },
  { value: "javascript", label: "JavaScript", placeholder: "function add(a,b){return a+b}const total=add(1,2);" },
  { value: "xml", label: "XML", placeholder: '<?xml version="1.0"?><note><to>Ana</to><body>Hi</body></note>' },
  { value: "sql", label: "SQL", placeholder: "select id, name from users where active = 1 order by name" },
];

const DIALECTS: SqlDialect[] = ["sql", "postgresql", "mysql", "sqlite"];

const FAQ_KEYS = ["upload", "minify", "lineBreaks", "sqlError"] as const;

interface Result {
  output: string;
  error: string;
}

const EMPTY: Result = { output: "", error: "" };

const lineCount = (text: string) => (text ? text.split("\n").length : 0);

export function CodeFormatter() {
  const t = useT();
  const [language, setLanguage] = useState<CodeLanguage>("html");
  const [mode, setMode] = useState<FormatMode>("beautify");
  const [indent, setIndent] = useState<IndentChoice>("2");
  const [dialect, setDialect] = useState<SqlDialect>("sql");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<Result>(EMPTY);

  // Debounce the text and the options together so an option change never runs on stale text
  const job = useMemo(() => ({ input, language, mode, indent, dialect }), [input, language, mode, indent, dialect]);
  const pending = useDebouncedValue(job);

  useEffect(() => {
    let cancelled = false;
    if (!pending.input.trim()) {
      setResult(EMPTY);
      return;
    }
    formatCode(pending.input, pending)
      .then((output) => {
        if (!cancelled) setResult({ output, error: "" });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({
            output: "",
            error: error instanceof SqlParseError ? t("error.sql", { message: error.message }) : error instanceof Error ? error.message : t("error.format"),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pending, t]);

  const current = input.trim() ? result : EMPTY;
  const languageInfo = LANGUAGES.find((l) => l.value === language) ?? LANGUAGES[0];
  const name = languageInfo.label;
  const resultTitle = (lang: string) => t(mode === "beautify" ? "pane.formatted" : "pane.minified", { language: lang });

  const status = () => {
    if (current.error) return <span className="text-destructive">{t("status.invalid")}</span>;
    if (!current.output) return <span>{t("status.ready")}</span>;
    const inBytes = new TextEncoder().encode(pending.input).length;
    const outBytes = new TextEncoder().encode(current.output).length;
    const saved = inBytes > 0 ? Math.round((1 - outBytes / inBytes) * 100) : 0;
    return (
      <>
        <span>
          {t("status.sizes", { input: formatBytes(inBytes), output: formatBytes(outBytes) })}
          {mode === "minify" && saved > 0 ? ` · ${t("status.smaller", { percent: formatNumber(saved) })}` : ""}
        </span>
        <span>{t("status.lines", { count: lineCount(current.output), n: formatNumber(lineCount(current.output)) })}</span>
        {mode === "minify" && language === "javascript" && <span>{t("status.namesKept")}</span>}
      </>
    );
  };

  return (
    <ToolWorkspace
      id="code-formatter"
      toolbar={
        <>
          <Tabs value={language} onValueChange={(v) => setLanguage(v as CodeLanguage)}>
            <TabsList aria-label={t("language.label")}>
              {LANGUAGES.map((l) => (
                <TabsTrigger key={l.value} value={l.value}>{l.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Tabs value={mode} onValueChange={(v) => setMode(v as FormatMode)}>
            <TabsList aria-label={t("mode.label")}>
              <TabsTrigger value="beautify">{t("mode.beautify")}</TabsTrigger>
              <TabsTrigger value="minify">{t("mode.minify")}</TabsTrigger>
            </TabsList>
          </Tabs>
          {mode === "beautify" && (
            <label className="indent-control">
              {t("indent.label")}
              <select aria-label={t("indent.aria")} value={indent} onChange={(e) => setIndent(e.target.value as IndentChoice)}>
                <option value="2">{t("indent.spaces", { count: 2 })}</option>
                <option value="4">{t("indent.spaces", { count: 4 })}</option>
                <option value="tab">{t("indent.tab")}</option>
              </select>
            </label>
          )}
          {language === "sql" && mode === "beautify" && (
            <label className="indent-control">
              {t("dialect.label")}
              <select aria-label={t("dialect.aria")} value={dialect} onChange={(e) => setDialect(e.target.value as SqlDialect)}>
                {DIALECTS.map((d) => (
                  <option key={d} value={d}>{t(`dialect.${d}`)}</option>
                ))}
              </select>
            </label>
          )}
        </>
      }
      notice={
        current.error ? (
          <div className="workspace-notice" data-tone="error" role="alert">{current.error}</div>
        ) : undefined
      }
      first={
        <EditorPane title={t("pane.input", { language: name })} htmlFor="code-formatter-input" scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}>
          <CodeTextarea
            id="code-formatter-input"
            wrap="off"
            placeholder={languageInfo.placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane title={resultTitle(name)} htmlFor={current.output ? "code-formatter-output" : undefined} scroll={false}
          actions={<CopyButton value={current.output} label={t("copy.language", { language: name })} />}>
          {current.output ? (
            <CodeTextarea id="code-formatter-output" wrap="off" value={current.output} readOnly />
          ) : (
            <PaneEmpty title={t(mode === "beautify" ? "empty.formatted" : "empty.minified", { language: name })} hint={t("empty.hint", { language: name })} />
          )}
        </EditorPane>
      }
      status={status()}
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
