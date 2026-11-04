import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMemo, useState } from "react";
import { toast } from "@/shims/sonner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "@/components/tools/CopyButton";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { formatNumber, useT, type TKey } from "@/lib/i18n";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { saveFile } from "@/lib/desktop";
import { csvToObjects, detectDelimiter, jsonToCsv, parseCSV, withBom } from "@/utils/csv";

const FAQ_KEYS = ["nested", "unflatten", "types", "excel"] as const;

type Direction = "csv-to-json" | "json-to-csv";

const DELIMITERS: Record<string, { label: TKey; value: string }> = {
  comma: { label: "delimiter.comma", value: "," },
  semicolon: { label: "delimiter.semicolon", value: ";" },
  tab: { label: "delimiter.tab", value: "\t" },
  pipe: { label: "delimiter.pipe", value: "|" },
};

const delimiterName = (value: string) =>
  Object.entries(DELIMITERS).find(([, d]) => d.value === value)?.[0] ?? "comma";

interface Result {
  output: string;
  error: string;
  rows: number;
  columns: number;
}

const EMPTY: Result = { output: "", error: "", rows: 0, columns: 0 };


export function CsvToJsonConverter() {
  const t = useT();
  const [direction, setDirection] = useState<Direction>("csv-to-json");
  const [input, setInput] = useState("");
  const [delimiterChoice, setDelimiterChoice] = useState("auto");
  const [options, setOptions] = useState({
    hasHeader: true,
    pretty: true,
    typed: false,
    nest: false,
    flatten: true,
    bom: false,
  });

  // Debounce input and direction together so a direction change never runs on stale text
  const job = useMemo(() => ({ input, direction }), [input, direction]);
  const pending = useDebouncedValue(job);
  const toJson = direction === "csv-to-json";
  const detected = delimiterName(detectDelimiter(pending.input));

  const result = useMemo<Result>(() => {
    const text = pending.input;
    if (!text.trim()) return EMPTY;
    const parsesCsv = pending.direction === "csv-to-json";
    const delimiter =
      delimiterChoice === "auto" ? (parsesCsv ? detectDelimiter(text) : ",") : DELIMITERS[delimiterChoice].value;
    try {
      if (parsesCsv) {
        const rows = csvToObjects(text, {
          delimiter,
          hasHeader: options.hasHeader,
          typed: options.typed,
          nest: options.nest,
        });
        return {
          output: options.pretty ? JSON.stringify(rows, null, 2) : JSON.stringify(rows),
          error: "",
          rows: rows.length,
          columns: Object.keys(rows[0] ?? {}).length,
        };
      }
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error(error instanceof Error && error.message ? t("error.invalidJson", { message: error.message }) : t("error.invalidJsonSyntax"));
      }
      const csv = jsonToCsv(data, { delimiter, hasHeader: options.hasHeader, flatten: options.flatten });
      const table = parseCSV(csv, { delimiter });
      return {
        output: csv,
        error: "",
        rows: Math.max(0, table.length - (options.hasHeader ? 1 : 0)),
        columns: table[0]?.length ?? 0,
      };
    } catch (error) {
      return { ...EMPTY, error: error instanceof Error ? error.message : t("error.convert") };
    }
  }, [pending, delimiterChoice, options, t]);

  // A result for the previous direction is stale until the debounce catches up
  const current = pending.direction === direction ? result : EMPTY;

  const changeDirection = (next: Direction) => {
    if (next === direction) return;
    // Use the last result as the next input.
    if (current.output) setInput(current.output);
    setDirection(next);
  };

  const inputName = toJson ? "CSV" : "JSON";
  const outputName = toJson ? "JSON" : "CSV";

  const saveOutput = async () => {
    const fileName = toJson ? "data.json" : "data.csv";
    const text = !toJson && options.bom ? withBom(current.output) : current.output;
    const type = toJson ? "application/json" : "text/csv;charset=utf-8";
    try {
      if (await saveFile(new Blob([text], { type }), fileName)) toast.success(t("toast.saved", { name: fileName }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.saveFailed"));
    }
  };

  return (
    <ToolWorkspace
      id="csv-json"
      toolbar={
        <>
          <Tabs value={direction} onValueChange={(v) => changeDirection(v as Direction)}>
            <TabsList aria-label={t("direction.label")}>
              <TabsTrigger value="csv-to-json">{t("direction.csvToJson")}</TabsTrigger>
              <TabsTrigger value="json-to-csv">{t("direction.jsonToCsv")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <label className="indent-control">
            {t("delimiter.label")}
            <select aria-label={t("delimiter.label")} value={delimiterChoice} onChange={(e) => setDelimiterChoice(e.target.value)}>
              <option value="auto">{toJson ? t("delimiter.auto", { delimiter: t(DELIMITERS[detected].label) }) : t("delimiter.autoComma")}</option>
              {Object.entries(DELIMITERS).map(([key, d]) => (
                <option key={key} value={key}>{t(d.label)}</option>
              ))}
            </select>
          </label>
        </>
      }
      notice={
        current.error ? (
          <div className="workspace-notice" data-tone="error" role="alert">{current.error}</div>
        ) : undefined
      }
      first={
        <EditorPane title={t("pane.input", { format: inputName })} htmlFor="csv-input" scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}>
          <div className="pane-options">
            <label className="option-switch" htmlFor="csv-has-header">
              {toJson ? t("option.firstRowHeader") : t("option.writeHeader")}
              <Switch id="csv-has-header" checked={options.hasHeader} onCheckedChange={(checked) => setOptions({ ...options, hasHeader: checked })} />
            </label>
            {!toJson && (
              <>
                <label className="option-switch" htmlFor="csv-flatten">
                  {t("option.flatten")}
                  <Switch id="csv-flatten" checked={options.flatten} onCheckedChange={(checked) => setOptions({ ...options, flatten: checked })} />
                </label>
                <label className="option-switch" htmlFor="csv-bom">
                  {t("option.bom")}
                  <Switch id="csv-bom" checked={options.bom} onCheckedChange={(checked) => setOptions({ ...options, bom: checked })} />
                </label>
              </>
            )}
            {toJson && (
              <>
                <label className="option-switch" htmlFor="csv-typed">
                  {t("option.detectTypes")}
                  <Switch id="csv-typed" checked={options.typed} onCheckedChange={(checked) => setOptions({ ...options, typed: checked })} />
                </label>
                <label className="option-switch" htmlFor="csv-nest">
                  {t("option.nest")}
                  <Switch id="csv-nest" checked={options.nest} onCheckedChange={(checked) => setOptions({ ...options, nest: checked })} />
                </label>
                <label className="option-switch" htmlFor="csv-pretty">
                  {t("option.pretty")}
                  <Switch id="csv-pretty" checked={options.pretty} onCheckedChange={(checked) => setOptions({ ...options, pretty: checked })} />
                </label>
              </>
            )}
          </div>
          <CodeTextarea
            id="csv-input"
            placeholder={toJson ? "name,age,city\nJohn,30,NYC\nJane,25,LA" : '[{"name":"John","age":30},{"name":"Jane","age":25}]'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.output", { format: outputName })} htmlFor={current.output ? "csv-output" : undefined} scroll={false}
          actions={
            <>
              {current.output && (
                <button type="button" className="toolbar-text-button" onClick={() => void saveOutput()}>
                  {t("action.save", { format: outputName })}
                </button>
              )}
              <CopyButton value={current.output} label={t("copy.format", { format: outputName })} />
            </>
          }>
          {current.output ? (
            <CodeTextarea id="csv-output" value={current.output} readOnly />
          ) : (
            <PaneEmpty title={t("empty.title", { format: outputName })} hint={t("empty.hint", { format: inputName })} />
          )}
        </EditorPane>
      }
      status={
        current.error ? (
          <span className="text-destructive">{t("status.invalid")}</span>
        ) : current.output ? (
          <span>{t("status.rows", { count: current.rows, n: formatNumber(current.rows) })} · {t("status.columns", { count: current.columns, n: formatNumber(current.columns) })}</span>
        ) : (
          <span>{t("status.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
