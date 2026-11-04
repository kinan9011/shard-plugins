import { TextTransform } from "./TextTransform";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMemo, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { GitCompare, ListOrdered, Shuffle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { compareLists, processLines, type LineFilter, type LineSort, type LineToolResult } from "@/utils/line-tools";
import { formatNumber, useT } from "@/lib/i18n";
import { DEFAULT_TRANSFORM_OPTIONS } from "@/utils/text-transform";

const FAQ_KEYS = ["order", "filter", "natural", "compare", "lineEndings"] as const;

const SORTS: LineSort[] = ["none", "asc", "desc", "natural", "length", "shuffle"];

type Mode = "process" | "compare" | "transform";
type CompareSet = "onlyA" | "onlyB" | "both" | "union";

const COMPARE_SETS: CompareSet[] = ["onlyA", "onlyB", "both", "union"];

const option = (id: string, label: string, checked: boolean, onChange: (next: boolean) => void, disabled = false) => (
  <label className="option-switch" htmlFor={id}>
    {label}
    <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
  </label>
);

const inputPane = (t: ReturnType<typeof useT>, id: string, title: string, value: string, onChange: (next: string) => void, placeholder: string) => (
  <EditorPane
    title={title}
    htmlFor={id}
    scroll={false}
    actions={value ? <button type="button" className="toolbar-text-button" onClick={() => onChange("")}>{t("common.clear")}</button> : undefined}
  >
    <CodeTextarea id={id} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  </EditorPane>
);

export function LineTools() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("process");
  const [input, setInput] = useState("");
  const [sort, setSort] = useState<LineSort>("none");
  const [reverse, setReverse] = useState(false);
  const [dedupe, setDedupe] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [trim, setTrim] = useState(false);
  const [removeEmpty, setRemoveEmpty] = useState(false);
  const [filterPattern, setFilterPattern] = useState("");
  const [filterMode, setFilterMode] = useState<NonNullable<LineFilter["mode"]>>("keep");
  const [filterRegex, setFilterRegex] = useState(false);
  // Changing the nonce runs the shuffle again.
  const [shuffleNonce, setShuffleNonce] = useState(0);
  const [transformOptions, setTransformOptions] = useState(DEFAULT_TRANSFORM_OPTIONS);
  const text = useDebouncedValue(input);
  const pattern = useDebouncedValue(filterPattern);

  const [listA, setListA] = useState("");
  const [listB, setListB] = useState("");
  const [compareSet, setCompareSet] = useState<CompareSet>("onlyA");
  const [compareIgnoreCase, setCompareIgnoreCase] = useState(false);
  const [compareTrim, setCompareTrim] = useState(true);
  const [ignoreBlank, setIgnoreBlank] = useState(true);
  const textA = useDebouncedValue(listA);
  const textB = useDebouncedValue(listB);

  const processed = useMemo<{ result: LineToolResult | null; error: string }>(() => {
    if (!text) return { result: null, error: "" };
    try {
      const filter = { pattern, mode: filterMode, regex: filterRegex };
      return { result: processLines(text, { filter, sort, reverse, dedupe, ignoreCase, trim, removeEmpty }), error: "" };
    } catch (err) {
      return { result: null, error: (err as Error).message };
    }
    // shuffleNonce is a deliberate trigger for a new shuffle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, pattern, filterMode, filterRegex, sort, reverse, dedupe, ignoreCase, trim, removeEmpty, shuffleNonce, t]);
  const result = processed.result;

  const compared = useMemo(() => {
    if (!textA && !textB) return null;
    return compareLists(textA, textB, { ignoreCase: compareIgnoreCase, trim: compareTrim, ignoreBlank });
  }, [textA, textB, compareIgnoreCase, compareTrim, ignoreBlank]);
  const compareOutput = compared ? compared[compareSet].join(compared.eol) : "";
  const compareLabel = t(`compareSet.${compareSet}`);
  const count = (key: "status.lines" | "status.uniqueItems" | "status.duplicatesRemoved" | "status.emptyRemoved", n: number) => t(key, { count: n, n: formatNumber(n) });

  const modeTabs = (
    <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
      <TabsList aria-label={t("mode.label")}>
        <TabsTrigger value="process">{t("mode.process")}</TabsTrigger>
        <TabsTrigger value="compare">{t("mode.compare")}</TabsTrigger>
        <TabsTrigger value="transform">{t("mode.transform")}</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  if (mode === "transform") {
    // Transform works on the same text as Process.
    return (
      <TextTransform
        navigation={modeTabs}
        input={input}
        onInputChange={setInput}
        options={transformOptions}
        onOptionsChange={setTransformOptions}
      />
    );
  }

  if (mode === "compare") {
    return (
      <ToolWorkspace
        wrapToolbar
        id="line-tools"
        toolbar={
          <>
            {modeTabs}
            <Tabs value={compareSet} onValueChange={(v) => setCompareSet(v as CompareSet)}>
              <TabsList aria-label={t("compareSet.label")}>
                {COMPARE_SETS.map((s) => (
                  <TabsTrigger key={s} value={s}>
                    {t(`compareSet.${s}`)}{compared ? ` (${formatNumber(compared[s].length)})` : ""}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </>
        }
        secondaryToolbar={
          <>
            {option("line-tools-compare-ignore-case", t("option.ignoreCase"), compareIgnoreCase, setCompareIgnoreCase)}
            {option("line-tools-compare-trim", t("option.trim"), compareTrim, setCompareTrim)}
            {option("line-tools-compare-ignore-blank", t("option.ignoreBlank"), ignoreBlank, setIgnoreBlank)}
          </>
        }
        first={
          <PanelGroup direction="vertical">
            <Panel minSize={20} defaultSize={50}>
              {inputPane(t, "line-tools-list-a", t("pane.listA"), listA, setListA, t("placeholder.listA"))}
            </Panel>
            <PanelResizeHandle className="editor-resize" aria-label={t("compare.resize")} />
            <Panel minSize={20} defaultSize={50}>
              {inputPane(t, "line-tools-list-b", t("pane.listB"), listB, setListB, t("placeholder.listB"))}
            </Panel>
          </PanelGroup>
        }
        second={
          <EditorPane
            title={t("pane.result")}
            htmlFor={compared ? "line-tools-compare-output" : undefined}
            scroll={false}
            actions={<CopyButton value={compareOutput} ariaLabel={t("copy.set", { set: compareLabel })} />}
          >
            {compared ? (
              <CodeTextarea id="line-tools-compare-output" value={compareOutput} readOnly />
            ) : (
              <PaneEmpty icon={<GitCompare size={20} aria-hidden="true" />} title={t("empty.compared")} hint={t("empty.comparedHint")} />
            )}
          </EditorPane>
        }
        status={
          compared ? (
            <span>
              {t("status.compare", {
                a: count("status.uniqueItems", compared.uniqueA),
                b: count("status.uniqueItems", compared.uniqueB),
                both: formatNumber(compared.both.length),
              })}
            </span>
          ) : (
            <span>{t("status.ready")}</span>
          )
        }
        help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
      />
    );
  }

  return (
    <ToolWorkspace
      wrapToolbar
      id="line-tools"
      toolbar={
        <>
          {modeTabs}
          <Tabs value={sort} onValueChange={(v) => setSort(v as LineSort)}>
            <TabsList aria-label={t("sort.label")}>
              {SORTS.map((s) => (
                <TabsTrigger key={s} value={s}>{t(`sort.${s}`)}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {sort === "shuffle" && (
            <button type="button" className="toolbar-text-button" onClick={() => setShuffleNonce((n) => n + 1)} disabled={!result}>
              <Shuffle size={14} aria-hidden="true" />
              {t("action.shuffleAgain")}
            </button>
          )}
        </>
      }
      secondaryToolbar={
        <div className="regex-fields">
          <div className="regex-field">
            <select
              aria-label={t("filter.mode")}
              className="h-7 rounded-md border border-input bg-background ps-1.5 pe-6 text-xs text-foreground"
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as NonNullable<LineFilter["mode"]>)}
            >
              <option value="keep">{t("filter.keep")}</option>
              <option value="remove">{t("filter.remove")}</option>
            </select>
            <Input
              aria-label={t("filter.lines")}
              className="h-7 text-xs font-mono"
              value={filterPattern}
              onChange={(e) => setFilterPattern(e.target.value)}
              placeholder={t(filterRegex ? "filter.placeholderRegex" : "filter.placeholderText")}
              aria-invalid={Boolean(processed.error)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {option("line-tools-filter-regex", t("option.regex"), filterRegex, setFilterRegex)}
          {option("line-tools-reverse", t("option.reverse"), reverse, setReverse)}
          {option("line-tools-dedupe", t("option.dedupe"), dedupe, setDedupe)}
          {option("line-tools-ignore-case", t("option.ignoreCase"), ignoreCase, setIgnoreCase)}
          {option("line-tools-trim", t("option.trim"), trim, setTrim)}
          {option("line-tools-remove-empty", t("option.removeEmpty"), removeEmpty, setRemoveEmpty)}
        </div>
      }
      notice={
        processed.error ? (
          <div className="workspace-notice" data-tone="error" role="alert">{processed.error}</div>
        ) : undefined
      }
      first={inputPane(t, "line-tools-input", t("pane.lines"), input, setInput, t("placeholder.lines"))}
      second={
        <EditorPane
          title={t("pane.result")}
          htmlFor={result ? "line-tools-output" : undefined}
          scroll={false}
          actions={<CopyButton value={result?.output ?? ""} ariaLabel={t("copy.result")} />}
        >
          {result ? (
            <CodeTextarea id="line-tools-output" value={result.output} readOnly />
          ) : (
            <PaneEmpty icon={<ListOrdered size={20} aria-hidden="true" />} title={t("empty.processed")} />
          )}
        </EditorPane>
      }
      status={
        result ? (
          <span>
            {[
              t("status.flow", { input: count("status.lines", result.inputLines), output: count("status.lines", result.outputLines) }),
              ...(result.filterMatched !== undefined ? [t("status.matched", { count: result.filterMatched, n: formatNumber(result.filterMatched) })] : []),
              ...(dedupe ? [count("status.duplicatesRemoved", result.duplicatesRemoved)] : []),
              ...(removeEmpty && result.emptyRemoved > 0 ? [count("status.emptyRemoved", result.emptyRemoved)] : []),
            ].join(" · ")}
          </span>
        ) : (
          <span>{t("status.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
