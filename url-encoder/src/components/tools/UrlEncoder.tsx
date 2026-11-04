import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2 } from "lucide-react";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { useT } from "@/lib/i18n";
import {
  buildUrlFromDetails,
  decodeUrl,
  encodeUrl,
  parseUrlDetails,
  type ParsedUrlDetails,
} from "@/utils/url";

type Mode = "encode" | "decode" | "parse";
type Scope = "component" | "full";

const FAQ_KEYS = ["what", "base64", "spaces", "parse", "scope"] as const;

// [key of the label, field of the parsed URL]
const PARTS = [
  ["protocol", "protocol"],
  ["username", "username"],
  ["password", "password"],
  ["host", "hostname"],
  ["port", "port"],
  ["path", "pathname"],
  ["hash", "hash"],
] as const;

export function UrlEncoder() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("encode");
  const [scope, setScope] = useState<Scope>("component");
  const [form, setForm] = useState(false);
  const [input, setInput] = useState("");
  const [parseInput, setParseInput] = useState("");
  const [parsed, setParsed] = useState<ParsedUrlDetails | null>(null);
  const [parseError, setParseError] = useState("");

  const pendingInput = useDebouncedValue(input);
  const pendingParse = useDebouncedValue(parseInput);

  const result = useMemo(() => {
    if (!pendingInput) return { output: "", error: "" };
    const options = { component: scope === "component", form: scope === "component" && form };
    try {
      return { output: mode === "decode" ? decodeUrl(pendingInput, options) : encodeUrl(pendingInput, options), error: "" };
    } catch {
      return { output: "", error: t(mode === "decode" ? "error.decode" : "error.encode") };
    }
  }, [pendingInput, mode, scope, form, t]);

  // Parse again when the URL changes. Parameter edits apply to the last parse.
  useEffect(() => {
    if (!pendingParse.trim()) {
      setParsed(null);
      setParseError("");
      return;
    }
    const next = parseUrlDetails(pendingParse);
    if (!next.ok) {
      setParsed(null);
      setParseError(next.error);
    } else {
      setParsed(next.value);
      setParseError("");
    }
  }, [pendingParse, t]);

  const updateParam = (index: number, field: "key" | "value", value: string) => {
    setParsed((prev) =>
      prev
        ? { ...prev, params: prev.params.map((p, i) => (i === index ? { ...p, [field]: value } : p)) }
        : prev
    );
  };

  const removeParam = (index: number) => {
    setParsed((prev) => (prev ? { ...prev, params: prev.params.filter((_, i) => i !== index) } : prev));
  };

  const addParam = () => {
    setParsed((prev) => (prev ? { ...prev, params: [...prev.params, { key: "", value: "" }] } : prev));
  };

  const rebuiltUrl = parsed ? buildUrlFromDetails(parsed) : "";

  // Move the result into the input and reverse the direction
  const swap = () => {
    setInput(result.output);
    setMode(mode === "encode" ? "decode" : "encode");
  };

  const parsing = mode === "parse";
  const error = parsing ? parseError : result.error;
  const decoding = mode === "decode";
  const outputTitle = t(decoding ? "pane.decoded" : "pane.encoded");

  const status = () => {
    if (error) return <span className="text-destructive">{t("status.invalid")}</span>;
    if (parsing) {
      if (!parsed) return <span>{t("status.ready")}</span>;
      return <span>{t("status.params", { host: parsed.hostname || parsed.protocol, count: parsed.params.length })}</span>;
    }
    if (!result.output) return <span>{t("status.ready")}</span>;
    return <span>{t("status.chars", { input: pendingInput.length, count: result.output.length })}</span>;
  };

  const parts = parsed
    ? PARTS.map(([key, field]) => [key, parsed[field]] as const).filter(
        ([key, value]) => value || key === "protocol" || key === "host" || key === "path"
      )
    : [];

  return (
    <ToolWorkspace
      id="url-encoder"
      toolbar={
        <>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList aria-label={t("mode.label")}>
              <TabsTrigger value="encode">{t("mode.encode")}</TabsTrigger>
              <TabsTrigger value="decode">{t("mode.decode")}</TabsTrigger>
              <TabsTrigger value="parse">{t("mode.parse")}</TabsTrigger>
            </TabsList>
          </Tabs>
          {!parsing && (
            <>
              <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)} className="indent-control">
                <TabsList aria-label={t("scope.label")}>
                  <TabsTrigger value="component">{t("scope.component")}</TabsTrigger>
                  <TabsTrigger value="full">{t("scope.full")}</TabsTrigger>
                </TabsList>
              </Tabs>
              {scope === "component" && (
                <label className="option-switch" htmlFor="url-form">
                  {t("option.spacesAsPlus")}
                  <Switch id="url-form" checked={form} onCheckedChange={setForm} />
                </label>
              )}
              <button type="button" className="toolbar-text-button" onClick={swap} disabled={!result.output}>
                {t("action.swap")}
              </button>
            </>
          )}
        </>
      }
      notice={error ? <div className="workspace-notice" data-tone="error" role="alert">{error}</div> : undefined}
      first={
        parsing ? (
          <EditorPane title={t("pane.url")} htmlFor="parse-input" scroll={false}
            actions={parseInput ? <button type="button" className="toolbar-text-button" onClick={() => setParseInput("")}>{t("common.clear")}</button> : undefined}>
            <CodeTextarea
              id="parse-input"
              placeholder="https://user:pass@example.com:8080/path?tag=a&tag=b#top"
              value={parseInput}
              onChange={(e) => setParseInput(e.target.value)}
            />
          </EditorPane>
        ) : (
          <EditorPane title={decoding ? t("pane.encodedText") : t("pane.text")} htmlFor="url-input" scroll={false}
            actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}>
            <CodeTextarea
              id="url-input"
              placeholder={t(decoding ? "placeholder.decode" : "placeholder.encode")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </EditorPane>
        )
      }
      second={
        parsing ? (
          <EditorPane title={t("pane.parts")}>
            {parsed ? (
              <div className="result-list">
                {parts.map(([key, value]) => (
                  <div key={key} className="result-row">
                    <span className="result-row-label">{t(`part.${key}`)}</span>
                    <span className="result-row-value" dir="ltr">{value}</span>
                    <CopyButton value={value} iconOnly label={t(`copy.${key}`)} />
                  </div>
                ))}
                <div className="pane-options">
                  <span className="font-medium">{t("params.title", { count: parsed.params.length })}</span>
                  <button type="button" className="toolbar-text-button" onClick={addParam}>
                    <Plus size={14} aria-hidden="true" />
                    {t("params.add")}
                  </button>
                </div>
                {parsed.params.map((param, index) => (
                  <div key={index} className="flex gap-2 border-b px-4 py-2">
                    <Input
                      aria-label={t("params.nameLabel", { n: index + 1 })}
                      value={param.key}
                      onChange={(e) => updateParam(index, "key", e.target.value)}
                      className="h-7 font-mono text-xs"
                      placeholder={t("params.namePlaceholder")}
                    />
                    <Input
                      aria-label={t("params.valueLabel", { n: index + 1 })}
                      value={param.value}
                      onChange={(e) => updateParam(index, "value", e.target.value)}
                      className="h-7 font-mono text-xs"
                      placeholder={t("params.valuePlaceholder")}
                    />
                    <button
                      type="button"
                      className="toolbar-text-button"
                      aria-label={t("params.remove", { n: index + 1 })}
                      onClick={() => removeParam(index)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <div className="result-row">
                  <label className="result-row-label" htmlFor="parse-output">{t("parts.rebuilt")}</label>
                  <textarea
                    id="parse-output"
                    className="result-row-value code-textarea"
                    value={rebuiltUrl}
                    readOnly
                    dir="ltr"
                    rows={Math.max(1, Math.ceil(rebuiltUrl.length / 64))}
                  />
                  <CopyButton value={rebuiltUrl} iconOnly label={t("copy.url")} />
                </div>
              </div>
            ) : (
              <PaneEmpty title={t("empty.parts")} hint={t("empty.partsHint")} />
            )}
          </EditorPane>
        ) : (
          <EditorPane title={outputTitle} htmlFor={result.output ? "url-output" : undefined} scroll={false}
            actions={<CopyButton value={result.output} ariaLabel={t(decoding ? "copy.decoded" : "copy.encoded")} />}>
            {result.output ? (
              <CodeTextarea id="url-output" value={result.output} readOnly />
            ) : (
              <PaneEmpty title={t(decoding ? "empty.decoded" : "empty.encoded")} />
            )}
          </EditorPane>
        )
      }
      status={status()}
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
