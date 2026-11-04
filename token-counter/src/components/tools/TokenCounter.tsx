import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatNumber, useT } from "@/lib/i18n";
import {
  basisLabel,
  CONTEXT_PRESETS,
  ESTIMATE_FAMILIES,
  MODEL_NAME_LIMIT,
  PRICE_TABLE_LIMIT,
  TOKEN_VIEW_LIMIT,
  contextUsage,
  costFor,
  countO200k,
  estimateTokens,
  familyLabel,
  exportPriceTable,
  formatUsd,
  getTextStats,
  importPriceTable,
  loadPriceRows,
  newRowId,
  savePriceRows,
  tokensForBasis,
  visibleWhitespace,
  type O200kResult,
  type PriceRow,
  type TokenBasis,
} from "@/utils/token-counter";

const FAQ_KEYS = ["exact", "estimates", "prices", "privacy"] as const;

const BASIS_OPTIONS: TokenBasis[] = ["openai", "claude", "gemini", "llama", "rule"];

const parseCount = (text: string) => {
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const parsePrice = (text: string) => {
  if (text.trim() === "") return Number.NaN;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
};

const n = (value: number) => formatNumber(value);

const SELECT_CLASS = "h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

function SectionTitle({ id, children }: { id?: string; children: string }) {
  return (
    <div className="pane-options">
      <h3 id={id} className="text-xs font-medium">{children}</h3>
    </div>
  );
}

function ContextMeter({ used, context }: { used: number; context: number }) {
  const t = useT();
  const usage = contextUsage(used, context);
  const width = Math.min(100, usage.percent);
  const digits = usage.percent < 10 && usage.percent > 0 ? 1 : 0;
  const percentText = `${formatNumber(usage.percent, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
  const valueText = t("context.value", { count: context, used: n(used), total: n(context), percent: percentText });
  return (
    <div className="flex flex-col gap-1.5 px-4 py-2">
      <div
        role="meter"
        aria-label={t("context.meter")}
        aria-valuemin={0}
        aria-valuemax={context}
        aria-valuenow={Math.min(used, context)}
        aria-valuetext={valueText}
        className="h-2.5 w-full overflow-hidden rounded-full border border-muted-foreground"
      >
        <div className={`h-full ${usage.over ? "bg-destructive" : "bg-primary"}`} style={{ width: `${width}%` }} />
      </div>
      <p className="text-xs tabular-nums">
        {valueText}
        {" · "}
        {usage.over ? (
          <span className="font-medium text-destructive">{t("context.over", { count: -usage.remaining, formatted: n(-usage.remaining) })}</span>
        ) : (
          <span className="text-muted-foreground">{t("context.left", { count: usage.remaining, formatted: n(usage.remaining) })}</span>
        )}
      </p>
    </div>
  );
}

function TokenView({ result }: { result: O200kResult }) {
  const t = useT();
  return (
    <>
      {result.truncated && (
        <div className="pane-options text-muted-foreground">
          {t("tokenView.truncated", { limit: n(TOKEN_VIEW_LIMIT), total: n(result.count) })}
        </div>
      )}
      <div className="whitespace-pre-wrap break-all px-4 py-3 font-mono text-xs leading-6" aria-label={t("tokenView.label")} role="group" dir="ltr" data-testid="token-view">
        {result.pieces.map((piece, i) => (
          <span
            key={i}
            className={`rounded-sm px-px ${i % 2 === 0 ? "bg-primary/10" : "bg-muted"}`}
            title={piece.tokens > 1 ? t("tokenView.multi", { tokens: piece.tokens }) : undefined}
          >
            {visibleWhitespace(piece.text)}
          </span>
        ))}
      </div>
    </>
  );
}

export function TokenCounter() {
  const t = useT();
  const [input, setInput] = useState("");
  const text = useDebouncedValue(input, 250);
  const [showTokens, setShowTokens] = useState(false);
  const [result, setResult] = useState<(O200kResult & { text: string; withPieces: boolean }) | null>(null);
  const [countError, setCountError] = useState("");

  const [outputText, setOutputText] = useState("0");
  const [contextText, setContextText] = useState("128000");

  const [rows, setRows] = useState<PriceRow[]>(() => loadPriceRows());
  const [draft, setDraft] = useState({ name: "", input: "", output: "", basis: "openai" as TokenBasis });
  const [draftError, setDraftError] = useState("");
  const [tablePanel, setTablePanel] = useState<"import" | "export" | null>(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  const stats = useMemo(() => getTextStats(text), [text]);

  useEffect(() => {
    if (!text) {
      setResult(null);
      setCountError("");
      return;
    }
    const controller = new AbortController();
    countO200k(text, { signal: controller.signal, pieceLimit: showTokens ? TOKEN_VIEW_LIMIT : 0 })
      .then((counted) => {
        setResult({ ...counted, text, withPieces: showTokens });
        setCountError("");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCountError("tokenizer");
      });
    return () => controller.abort();
  }, [text, showTokens]);

  const pending = input !== text;
  const counting = Boolean(text) && !countError && (!result || result.text !== text || (showTokens && !result.withPieces));
  const busy = pending || counting;
  // While a new count runs, the previous count stays on screen so the numbers do not flicker.
  const tokens = text && result ? result.count : 0;
  const hasCount = Boolean(text && result);

  const outputTokens = parseCount(outputText);
  const context = parseCount(contextText);

  const updateRows = (next: PriceRow[]) => {
    setRows(next);
    savePriceRows(next);
  };

  const addRow = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.name.trim();
    const inputPrice = parsePrice(draft.input);
    const outputPrice = parsePrice(draft.output);
    if (!name) return setDraftError(t("draft.needName"));
    if (Number.isNaN(inputPrice)) return setDraftError(t("draft.needInput"));
    if (Number.isNaN(outputPrice)) return setDraftError(t("draft.needOutput"));
    if (rows.length >= PRICE_TABLE_LIMIT) return setDraftError(t("import.tooMany", { max: PRICE_TABLE_LIMIT }));
    updateRows([...rows, { id: newRowId(), name, input: inputPrice, output: outputPrice, basis: draft.basis }]);
    setDraft({ name: "", input: "", output: "", basis: draft.basis });
    setDraftError("");
  };

  const runImport = () => {
    const parsed = importPriceTable(importText);
    if ("error" in parsed) {
      setImportError(parsed.error);
      return;
    }
    updateRows(parsed.rows);
    setImportError("");
    setImportText("");
    setTablePanel(null);
  };

  const summary = hasCount
    ? JSON.stringify(
        {
          o200kTokens: tokens,
          estimates: Object.fromEntries(ESTIMATE_FAMILIES.map((f) => [f.id, estimateTokens(f, tokens, stats).value])),
          characters: stats.characters,
          words: stats.words,
          lines: stats.lines,
          utf8Bytes: stats.bytes,
        },
        null,
        2,
      )
    : "";

  const countValue = (value: number) => (hasCount ? n(value) : busy ? t("status.counting") : "0");
  const exported = tablePanel === "export" ? exportPriceTable(rows) : "";

  return (
    <ToolWorkspace
      id="token-counter"
      toolbar={
        <>
          <label className="option-switch" htmlFor="token-show">
            {t("option.showTokens")}
            <Switch id="token-show" checked={showTokens} onCheckedChange={setShowTokens} />
          </label>
          <CopyButton value={summary} label={t("copy.counts")} />
        </>
      }
      notice={countError ? <div className="workspace-notice" data-tone="error" role="alert">{t("error.tokenizer")}</div> : undefined}
      first={
        <EditorPane
          title={t("pane.text")}
          htmlFor="token-input"
          scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea
            id="token-input"
            placeholder={t("input.placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.counts")}>
          <div className="result-list">
            <div className="result-row">
              <span className="result-row-label">{t("count.openai")}</span>
              <span className="result-row-value tabular-nums" data-testid="token-count">{countValue(tokens)}</span>
              <span className="text-2xs text-muted-foreground">{t("count.exact")}</span>
            </div>
            {(
              [
                ["count.characters", stats.characters],
                ["count.words", stats.words],
                ["count.lines", stats.lines],
                ["count.bytes", stats.bytes],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="result-row">
                <span className="result-row-label">{t(label)}</span>
                <span className="result-row-value tabular-nums">{n(value)}</span>
                <span />
              </div>
            ))}

            <SectionTitle>{t("section.other")}</SectionTitle>
            {ESTIMATE_FAMILIES.map((family) => {
              const estimate = estimateTokens(family, tokens, stats);
              const ready = family.id === "rule" || hasCount;
              return (
                <div key={family.id} className="result-row">
                  <span className="result-row-label">{familyLabel(family)}</span>
                  <span className="result-row-value tabular-nums">
                    {ready ? `≈ ${n(estimate.value)}` : busy ? t("status.counting") : "≈ 0"}
                    {ready && estimate.value > 0 && (
                      <span className="text-muted-foreground"> {t("estimate.range", { low: n(estimate.low), high: n(estimate.high) })}</span>
                    )}
                  </span>
                  <span className="text-2xs text-muted-foreground">{t("estimate.badge")}</span>
                </div>
              );
            })}

            {showTokens && (
              <>
                <SectionTitle>{t("section.tokens")}</SectionTitle>
                {result && result.text === text && result.withPieces ? (
                  result.count > 0 ? <TokenView result={result} /> : null
                ) : text ? (
                  <div className="pane-options text-muted-foreground">{t("status.counting")}</div>
                ) : (
                  <div className="pane-options text-muted-foreground">{t("tokenView.enterText")}</div>
                )}
              </>
            )}

            <SectionTitle>{t("section.context")}</SectionTitle>
            <div className="pane-options">
              <label htmlFor="token-context" className="font-medium">{t("context.size")}</label>
              <Input
                id="token-context"
                type="number"
                min={1}
                className="h-7 w-28 text-xs tabular-nums"
                value={contextText}
                onChange={(e) => setContextText(e.target.value)}
              />
              <div className="flex flex-wrap gap-1" role="group" aria-label={t("context.presets")}>
                {CONTEXT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="toolbar-text-button border border-border"
                    aria-pressed={context === preset.value}
                    aria-label={t("context.presetLabel", { label: preset.label, tokens: n(preset.value) })}
                    onClick={() => setContextText(String(preset.value))}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            {context > 0 ? (
              <ContextMeter used={tokens + outputTokens} context={context} />
            ) : (
              <div className="pane-options text-muted-foreground">{t("context.enter")}</div>
            )}
            <div className="px-4 pb-2 text-2xs text-muted-foreground">{t("context.note")}</div>

            <SectionTitle id="token-cost-title">{t("section.cost")}</SectionTitle>
            <div className="pane-options">
              <label htmlFor="token-output" className="font-medium">{t("cost.outputTokens")}</label>
              <Input
                id="token-output"
                type="number"
                min={0}
                className="h-7 w-28 text-xs tabular-nums"
                value={outputText}
                onChange={(e) => setOutputText(e.target.value)}
              />
              <span className="text-muted-foreground">{t("cost.outputHint")}</span>
            </div>

            {rows.length === 0 ? (
              <div className="pane-options text-muted-foreground">
                {t("cost.empty")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs" aria-labelledby="token-cost-title">
                  <thead className="text-start text-muted-foreground">
                    <tr className="border-b border-border/50">
                      <th scope="col" className="px-4 py-1.5 font-medium">{t("table.model")}</th>
                      <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("table.inputPrice")}</th>
                      <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("table.outputPrice")}</th>
                      <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("table.inputCost")}</th>
                      <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("table.outputCost")}</th>
                      <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("table.total")}</th>
                      <th scope="col" className="px-2 py-1.5"><span className="sr-only">{t("table.actions")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const estimated = row.basis !== "openai";
                      const inputTokens = tokensForBasis(row.basis, tokens, stats);
                      const cost = costFor(row, inputTokens, outputTokens);
                      const prefix = estimated ? "≈ " : "";
                      return (
                        <tr key={row.id} className="border-b border-border/50 tabular-nums" data-testid="price-row">
                          <th scope="row" className="px-4 py-1.5 text-start font-normal">
                            <span className="block font-medium">{row.name}</span>
                            <span className="block text-2xs text-muted-foreground">{basisLabel(row.basis)}</span>
                          </th>
                          <td className="px-2 py-1.5 text-end"><bdi dir="ltr">{`$${formatNumber(row.input, { maximumFractionDigits: 20, useGrouping: false })}`}</bdi></td>
                          <td className="px-2 py-1.5 text-end"><bdi dir="ltr">{`$${formatNumber(row.output, { maximumFractionDigits: 20, useGrouping: false })}`}</bdi></td>
                          <td className="px-2 py-1.5 text-end"><bdi dir="ltr">{prefix}{formatUsd(cost.input)}</bdi></td>
                          <td className="px-2 py-1.5 text-end"><bdi dir="ltr">{formatUsd(cost.output)}</bdi></td>
                          <td className="px-2 py-1.5 text-end font-medium">
                            <bdi dir="ltr">{prefix}{formatUsd(cost.total)}</bdi>
                            {estimated && <span className="block text-2xs font-normal text-muted-foreground">{t("estimate.badge")}</span>}
                          </td>
                          <td className="px-2 py-1.5 text-end">
                            <button
                              type="button"
                              className="toolbar-text-button"
                              aria-label={t("table.remove", { name: row.name })}
                              onClick={() => updateRows(rows.filter((r) => r.id !== row.id))}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <form className="pane-options" onSubmit={addRow} aria-label={t("form.label")}>
              <label htmlFor="token-price-name" className="sr-only">{t("form.name")}</label>
              <Input
                id="token-price-name"
                className="h-7 w-40 text-xs"
                placeholder={t("form.name")}
                maxLength={MODEL_NAME_LIMIT}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                autoComplete="off"
              />
              <label htmlFor="token-price-input" className="sr-only">{t("form.inputLabel")}</label>
              <Input
                id="token-price-input"
                type="number"
                min={0}
                step="any"
                className="h-7 w-28 text-xs tabular-nums"
                placeholder={t("form.inputPlaceholder")}
                value={draft.input}
                onChange={(e) => setDraft({ ...draft, input: e.target.value })}
              />
              <label htmlFor="token-price-output" className="sr-only">{t("form.outputLabel")}</label>
              <Input
                id="token-price-output"
                type="number"
                min={0}
                step="any"
                className="h-7 w-28 text-xs tabular-nums"
                placeholder={t("form.outputPlaceholder")}
                value={draft.output}
                onChange={(e) => setDraft({ ...draft, output: e.target.value })}
              />
              <label htmlFor="token-price-basis" className="sr-only">{t("form.basis")}</label>
              <select
                id="token-price-basis"
                className={SELECT_CLASS}
                value={draft.basis}
                onChange={(e) => setDraft({ ...draft, basis: e.target.value as TokenBasis })}
              >
                {BASIS_OPTIONS.map((basis) => (
                  <option key={basis} value={basis}>{basisLabel(basis)}</option>
                ))}
              </select>
              <button type="submit" className="toolbar-text-button border border-border">
                <Plus size={14} aria-hidden="true" />
                {t("form.add")}
              </button>
            </form>
            {draftError && <div className="workspace-notice" data-tone="error" role="alert">{draftError}</div>}

            <div className="pane-options">
              <button
                type="button"
                className="toolbar-text-button"
                aria-expanded={tablePanel === "import"}
                onClick={() => {
                  setTablePanel(tablePanel === "import" ? null : "import");
                  setImportError("");
                }}
              >
                <Upload size={14} aria-hidden="true" />
                {t("table.import")}
              </button>
              <button
                type="button"
                className="toolbar-text-button"
                aria-expanded={tablePanel === "export"}
                disabled={rows.length === 0}
                onClick={() => setTablePanel(tablePanel === "export" ? null : "export")}
              >
                <Download size={14} aria-hidden="true" />
                {t("table.export")}
              </button>
            </div>
            {tablePanel === "import" && (
              <div className="flex flex-col gap-2 px-4 pb-3">
                <label htmlFor="token-import" className="text-xs font-medium">{t("table.json")}</label>
                <CodeTextarea
                  id="token-import"
                  className="min-h-32 rounded-md border border-input"
                  placeholder={'{ "models": [{ "name": "my-model", "input": 2.5, "output": 10 }] }'}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                {importError && <div className="workspace-notice" data-tone="error" role="alert">{importError}</div>}
                <div className="flex gap-2">
                  <button type="button" className="toolbar-text-button border border-border" onClick={runImport} disabled={!importText.trim()}>
                    {t("table.replace")}
                  </button>
                  <span className="self-center text-2xs text-muted-foreground">{t("table.importNote")}</span>
                </div>
              </div>
            )}
            {tablePanel === "export" && (
              <div className="flex flex-col gap-2 px-4 pb-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="token-export" className="text-xs font-medium">{t("table.json")}</label>
                  <CopyButton value={exported} label={t("copy.json")} />
                </div>
                <CodeTextarea id="token-export" className="min-h-32 rounded-md border border-input" value={exported} readOnly />
              </div>
            )}
          </div>
        </EditorPane>
      }
      status={
        text ? (
          <>
            <span className="tabular-nums">{busy ? t("status.counting") : t("status.tokens", { count: tokens, formatted: n(tokens) })}</span>
            <span className="tabular-nums">{t("status.characters", { count: stats.characters, formatted: n(stats.characters) })}</span>
          </>
        ) : (
          <span>{t("ui.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }))} />}
    />
  );
}
