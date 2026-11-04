import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { autoDir, formatNumber, useT, type TKey } from "@/lib/i18n";
import { DEFAULT_CLEAN_OPTIONS, cleanText, type ChangeKind, type CleanOptions, type EmDashStyle } from "@/utils/ai-text-cleaner";

const FAQ_KEYS = ["invisible", "code", "citations", "twice"] as const;

const CHANGE_NAMES: Record<ChangeKind, TKey> = {
  invisible: "change.invisible",
  spaces: "change.spaces",
  citations: "change.citations",
  markdown: "change.markdown",
  quotes: "change.quotes",
  dashes: "change.dashes",
  ellipsis: "change.ellipsis",
  whitespace: "change.whitespace",
};

type BooleanOption = Exclude<keyof CleanOptions, "emDashStyle">;

const PRIMARY_OPTIONS: { key: BooleanOption; label: TKey }[] = [
  { key: "invisible", label: "option.invisible" },
  { key: "spaces", label: "option.spaces" },
  { key: "quotes", label: "option.quotes" },
  { key: "ellipsis", label: "option.ellipsis" },
  { key: "citations", label: "option.citations" },
  { key: "whitespace", label: "option.whitespace" },
];

export function AiTextCleaner() {
  const t = useT();
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<CleanOptions>(DEFAULT_CLEAN_OPTIONS);
  const text = useDebouncedValue(input);

  const result = useMemo(() => (text ? cleanText(text, options) : null), [text, options, t]);

  const set = <K extends keyof CleanOptions>(key: K, value: CleanOptions[K]) => setOptions((current) => ({ ...current, [key]: value }));

  const option = (key: BooleanOption, label: string, disabled = false) => {
    const id = `ai-text-cleaner-${key}`;
    return (
      <label key={key} className="option-switch" htmlFor={id}>
        {label}
        <Switch id={id} checked={options[key]} onCheckedChange={(on) => set(key, on)} disabled={disabled} />
      </label>
    );
  };

  return (
    <ToolWorkspace
      id="ai-text-cleaner"
      toolbar={<>{PRIMARY_OPTIONS.map((o) => option(o.key, t(o.label)))}</>}
      secondaryToolbar={
        <>
          {option("dashes", t("option.dashes"))}
          <Tabs value={options.emDashStyle} onValueChange={(v) => set("emDashStyle", v as EmDashStyle)}>
            <TabsList aria-label={t("dash.label")}>
              <TabsTrigger value="spaced" disabled={!options.dashes}>{t("dash.spaced")}</TabsTrigger>
              <TabsTrigger value="double" disabled={!options.dashes}>{t("dash.double")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="indent-control">{option("markdown", t("option.markdown"))}</span>
          {option("markdownLists", t("option.markdownLists"), !options.markdown)}
        </>
      }
      first={
        <EditorPane
          title={t("pane.text")}
          htmlFor="ai-text-cleaner-input"
          scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea
            id="ai-text-cleaner-input"
            placeholder={t("input.placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane
          title={t("pane.cleaned")}
          htmlFor={result ? "ai-text-cleaner-output" : undefined}
          scroll={false}
          actions={<CopyButton value={result?.output ?? ""} label={t("common.copy")} ariaLabel={t("copy.cleaned")} />}
        >
          {result ? (
            <>
              <CodeTextarea id="ai-text-cleaner-output" value={result.output} readOnly dir={autoDir(result.output)} />
              <div className="max-h-[40%] shrink-0 overflow-auto border-t border-border">
                <div className="result-list">
                  <div className="pane-options">
                    <span className="font-medium" id="ai-text-cleaner-changes">{t("changes.title")}</span>
                  </div>
                  {result.changes.length === 0 ? (
                    <div className="pane-options text-muted-foreground">{t("changes.none")}</div>
                  ) : (
                    <div role="table" aria-labelledby="ai-text-cleaner-changes">
                      {result.changes.map((change) => (
                        <div key={change.kind} className="result-row" role="row">
                          <span className="result-row-label" role="cell">{t(CHANGE_NAMES[change.kind])}</span>
                          <span className="result-row-value" role="cell">{change.label}</span>
                          <span role="cell" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <PaneEmpty
              icon={<Sparkles size={20} aria-hidden="true" />}
              title={t("empty.title")}
              hint={t("empty.hint")}
            />
          )}
        </EditorPane>
      }
      status={
        result ? (
          <>
            <span>
              {t("status.chars", { count: result.output.length, from: formatNumber(text.length), to: formatNumber(result.output.length) })}
            </span>
            <span>{result.total === 0 ? t("status.noChanges") : t("status.changes", { count: result.total, number: formatNumber(result.total) })}</span>
          </>
        ) : (
          <span>{t("status.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }))} />}
    />
  );
}
