import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { formatNumber, useT } from "@/lib/i18n";
import { countO200k } from "@/utils/token-counter";
import {
  CONFIG_FORMATS,
  FORMAT_NAMES,
  compareTokens,
  convertConfig,
  detectConfigFormat,
  loadToml,
  loadToon,
  needsToml,
  needsToon,
  type ConfigFormat,
  type EnvNesting,
  type TokenComparison,
  type TomlModule,
  type ToonDelimiter,
  type ToonModule,
  type YamlIndent,
} from "@/utils/yaml-json";

interface Result {
  output: string;
  error: string;
  documents: number;
  data?: unknown;
}

const EMPTY: Result = { output: "", error: "", documents: 0 };

const PLACEHOLDERS: Record<ConfigFormat, string> = {
  yaml: "name: Shard\ntags:\n  - offline\n  - desktop",
  json: '{"name":"Shard","tags":["offline","desktop"]}',
  toml: '[package]\nname = "shard"\nversion = "2.1.0"',
  env: "# .env\nPORT=3000\nDATABASE_URL=\"postgres://localhost/app\"",
  properties: "server.port=8080\nspring.application.name=shard",
  toon: "name: Shard\ntools[2]{id,offline}:\n  json-viewer,true\n  yaml-json,true",
};

const countTokens = (text: string, signal: AbortSignal) => countO200k(text, { signal }).then((result) => result.count);

const FAQ_KEYS = ["upload", "formats", "documents", "toon", "toonTokens", "tokens", "delimiter", "envNesting", "properties", "quoted", "tomlNull", "comments", "syntax"] as const;

const FormatSelect = ({ label, name, value, onChange }: { label: string; name: string; value: ConfigFormat; onChange: (next: ConfigFormat) => void }) => (
  <label className="indent-control">
    {label}
    <select aria-label={name} value={value} onChange={(e) => onChange(e.target.value as ConfigFormat)}>
      {CONFIG_FORMATS.map((format) => (
        <option key={format} value={format}>{FORMAT_NAMES[format]}</option>
      ))}
    </select>
  </label>
);

export function YamlJson() {
  const t = useT();
  const [from, setFrom] = useState<ConfigFormat>("yaml");
  const [to, setTo] = useState<ConfigFormat>("json");
  const [input, setInput] = useState("");
  const [indent, setIndent] = useState<YamlIndent>(2);
  const [envNesting, setEnvNesting] = useState<EnvNesting>("__");
  const [toonDelimiter, setToonDelimiter] = useState<ToonDelimiter>(",");
  const [toml, setToml] = useState<TomlModule>();
  const [toon, setToon] = useState<ToonModule>();
  const [loadError, setLoadError] = useState("");

  const tomlNeeded = needsToml(from, to);
  useEffect(() => {
    if (!tomlNeeded || toml) return;
    let cancelled = false;
    loadToml()
      .then((mod) => !cancelled && setToml(mod))
      .catch(() => !cancelled && setLoadError(t("error.loadToml")));
    return () => {
      cancelled = true;
    };
  }, [tomlNeeded, toml, t]);

  const toonNeeded = needsToon(from, to);
  useEffect(() => {
    if (!toonNeeded || toon) return;
    let cancelled = false;
    loadToon()
      .then((mod) => !cancelled && setToon(mod))
      .catch(() => !cancelled && setLoadError(t("error.loadToon")));
    return () => {
      cancelled = true;
    };
  }, [toonNeeded, toon, t]);

  // Debounce input and formats together so a format change never runs on stale text
  const job = useMemo(() => ({ input, from, to }), [input, from, to]);
  const pending = useDebouncedValue(job);
  const waitingForToml = needsToml(pending.from, pending.to) && !toml;
  const waitingForToon = needsToon(pending.from, pending.to) && !toon;

  const result = useMemo<Result>(() => {
    if (!pending.input.trim() || waitingForToml || waitingForToon) return EMPTY;
    try {
      const converted = convertConfig(pending.input, pending.from, pending.to, { indent, envNesting, toonDelimiter }, toml, toon);
      return { ...converted, error: "" };
    } catch (error) {
      return { ...EMPTY, error: error instanceof Error ? error.message : t("error.convert") };
    }
  }, [pending, indent, envNesting, toonDelimiter, toml, toon, waitingForToml, waitingForToon, t]);

  // A result for the previous formats or text is stale until the debounce catches up
  const current = pending.from === from && pending.to === to && input.trim() ? result : EMPTY;
  const error = loadError || current.error;

  // The token comparison loads the tokenizer only when one side is TOON
  const toonText = !result.output ? "" : pending.to === "toon" ? result.output : pending.from === "toon" ? pending.input : "";
  const [tokens, setTokens] = useState<{ result: Result; value: TokenComparison }>();
  useEffect(() => {
    if (!toonText) return;
    const controller = new AbortController();
    compareTokens(result.data, toonText, (text) => countTokens(text, controller.signal))
      .then((value) => !controller.signal.aborted && setTokens({ result, value }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [result, toonText]);
  const comparison = toonText && tokens?.result === current ? tokens.value : undefined;

  const changeInput = (next: string) => {
    // A paste into an empty input sets the source format. Typing never changes it.
    if (!input.trim() && next.trim().length > 1) {
      const detected = detectConfigFormat(next);
      if (detected && detected !== from) {
        setFrom(detected);
        if (detected === to) setTo(detected === "json" ? "yaml" : "json");
      }
    }
    setInput(next);
  };

  // Picking the format on the other side swaps the two, so source and target stay different.
  const changeFrom = (next: ConfigFormat) => {
    if (next === to) setTo(from);
    setFrom(next);
  };
  const changeTo = (next: ConfigFormat) => {
    if (next === from) setFrom(to);
    setTo(next);
  };

  const swap = () => {
    setInput(current.output);
    setFrom(to);
    setTo(from);
  };

  const inputName = FORMAT_NAMES[from];
  const outputName = FORMAT_NAMES[to];

  const formatCount = (n: number) => formatNumber(n);

  const status = () => {
    if (error) return <span className="text-destructive">{t("status.invalid")}</span>;
    if (input.trim() && waitingForToml) return <span>{t("status.loadingToml")}</span>;
    if (input.trim() && waitingForToon) return <span>{t("status.loadingToon")}</span>;
    if (!current.output) return <span>{t("status.ready")}</span>;
    const lines = current.output.split("\n").length;
    return (
      <>
        <span>{t("status.lines", { count: lines })}</span>
        {(to === "json" || to === "toon") && current.documents > 1 && <span>{t(to === "json" ? "status.documentsJson" : "status.documentsToon", { count: current.documents })}</span>}
        {comparison && (
          <span data-testid="toon-tokens" title={t("tokens.title")}>
            {t(comparison.saved >= 0 ? "tokens.saves" : "tokens.costs", {
              toon: formatCount(comparison.toon),
              json: formatCount(comparison.json),
              pretty: formatCount(comparison.prettyJson),
              percent: Math.abs(comparison.saved),
            })}
          </span>
        )}
      </>
    );
  };

  return (
    <ToolWorkspace
      id="yaml-json"
      toolbar={
        <>
          <FormatSelect label={t("format.from")} name={t("format.source")} value={from} onChange={changeFrom} />
          <FormatSelect label={t("format.to")} name={t("format.target")} value={to} onChange={changeTo} />
          {(to === "json" || to === "yaml" || to === "toon") && (
            <label className="indent-control">
              {t("indent.label")}
              <select aria-label={t("indent.aria")} value={indent} onChange={(e) => setIndent(Number(e.target.value) as YamlIndent)}>
                <option value="2">{t("indent.spaces", { count: 2 })}</option>
                <option value="4">{t("indent.spaces", { count: 4 })}</option>
              </select>
            </label>
          )}
          {to === "env" && (
            <label className="indent-control">
              {t("nested.label")}
              <select aria-label={t("nested.label")} value={envNesting} onChange={(e) => setEnvNesting(e.target.value as EnvNesting)}>
                <option value="__">A__B</option>
                <option value="_">A_B</option>
              </select>
            </label>
          )}
          {to === "toon" && (
            <label className="indent-control">
              {t("delimiter.label")}
              <select aria-label={t("delimiter.aria")} value={toonDelimiter} onChange={(e) => setToonDelimiter(e.target.value as ToonDelimiter)}>
                <option value=",">{t("delimiter.comma")}</option>
                <option value={"\t"}>{t("delimiter.tab")}</option>
                <option value="|">{t("delimiter.pipe")}</option>
              </select>
            </label>
          )}
          <button type="button" className="toolbar-text-button" onClick={swap} disabled={!current.output}>
            <ArrowLeftRight size={14} aria-hidden="true" />
            {t("action.swap")}
          </button>
        </>
      }
      notice={
        error ? (
          <div className="workspace-notice" data-tone="error" role="alert">{error}</div>
        ) : undefined
      }
      first={
        <EditorPane title={t("pane.input", { format: inputName })} htmlFor="yaml-json-input" scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}>
          <CodeTextarea
            id="yaml-json-input"
            placeholder={PLACEHOLDERS[from]}
            value={input}
            onChange={(e) => changeInput(e.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.output", { format: outputName })} htmlFor={current.output ? "yaml-json-output" : undefined} scroll={false}
          actions={<CopyButton value={current.output} label={t("copy.format", { format: outputName })} />}>
          {current.output ? (
            <CodeTextarea id="yaml-json-output" value={current.output} readOnly />
          ) : (
            <PaneEmpty title={t("empty.title", { format: outputName })} hint={t("empty.hint", { format: inputName })} />
          )}
        </EditorPane>
      }
      status={status()}
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
