import { useEffect, useMemo, useState } from "react";
import { useToolActive } from "@/hooks/useToolActive";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { useT } from "@/lib/i18n";
import { DIALECTS, DIALECT_LABELS, describePart, renderFormat, translateFormat, type Dialect } from "@/utils/date-format";

const FAQ_KEYS = ["goLayout", "letters", "escaping", "warnings", "source", "strftime"] as const;

/** Parses a datetime-local value as local time, or as UTC. */
const parsePreviewDate = (value: string, utc: boolean) => {
  if (!value) return null;
  const date = new Date(utc ? `${value}Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function DateFormatTranslator() {
  const t = useT();
  const [input, setInput] = useState("");
  const [source, setSource] = useState<Dialect | "auto">("auto");
  const [previewText, setPreviewText] = useState("");
  const [utc, setUtc] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const format = useDebouncedValue(input);

  // The preview follows the clock until the user picks a date.
  const toolActive = useToolActive();
  useEffect(() => {
    if (previewText || !toolActive) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [previewText, toolActive]);

  const translation = useMemo(() => (format ? translateFormat(format, source) : null), [format, source, t]);
  const previewDate = parsePreviewDate(previewText, utc) ?? now;
  const detectedLabel = translation?.detected ? DIALECT_LABELS[translation.source] : null;

  return (
    <ToolWorkspace
      id="date-format"
      toolbar={
        <label className="indent-control" style={{ paddingInlineStart: 0, borderInlineStart: 0 }}>
          {t("ui.source")}
          <select aria-label={t("ui.sourceDialect")} value={source} onChange={(e) => setSource(e.target.value as Dialect | "auto")}>
            <option value="auto">{detectedLabel ? t("ui.autoDetected", { dialect: detectedLabel }) : t("ui.auto")}</option>
            {DIALECTS.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </label>
      }
      secondaryToolbar={
        <>
          <label htmlFor="date-format-preview" className="text-xs text-muted-foreground">{t("ui.previewDate")}</label>
          <Input
            id="date-format-preview"
            type="datetime-local"
            step={1}
            className="h-7 w-56 text-xs"
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
          />
          <button type="button" className="toolbar-text-button" onClick={() => setPreviewText("")} disabled={!previewText}>
            {t("ui.now")}
          </button>
          <label className="option-switch indent-control" htmlFor="date-format-utc">
            UTC
            <Switch id="date-format-utc" checked={utc} onCheckedChange={setUtc} />
          </label>
        </>
      }
      notice={
        translation?.warnings.length ? (
          <div className="workspace-notice" role="status">{translation.warnings.join(" ")}</div>
        ) : undefined
      }
      first={
        <EditorPane
          title={t("ui.format")}
          htmlFor="date-format-input"
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea
            id="date-format-input"
            className="flex-none"
            rows={3}
            placeholder={t("ui.formatPlaceholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          {translation && translation.parts.length > 0 && (
            <table className="mx-4 mb-4 text-xs" aria-label={t("ui.tokens")}>
              <thead>
                <tr className="text-start text-muted-foreground">
                  <th className="py-1 pe-4 font-medium">{t("ui.token")}</th>
                  <th className="py-1 font-medium">{t("ui.meaning")}</th>
                </tr>
              </thead>
              <tbody>
                {translation.parts
                  .filter((part) => part.src)
                  .map((part, index) => (
                    <tr key={index} className="border-t border-border/50">
                      <td className="py-1 pe-4 font-mono whitespace-pre" dir="ltr">{part.src}</td>
                      <td className={`py-1 ${part.kind === "literal" ? "text-muted-foreground" : ""}`}>{describePart(part)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </EditorPane>
      }
      second={
        <EditorPane title={t("ui.translations")}>
          {translation ? (
            <div className="result-list">
              {DIALECTS.map(({ id, label }) => {
                const result = translation.targets[id];
                const isSource = id === translation.source;
                return (
                  <div key={id} className="result-row" style={{ alignItems: "start" }}>
                    <label className="result-row-label" htmlFor={`date-format-out-${id}`}>
                      {label}
                      {isSource && <span className="block font-normal">{t("ui.source")}</span>}
                    </label>
                    <div className="min-w-0">
                      <textarea
                        id={`date-format-out-${id}`}
                        className="result-row-value code-textarea w-full"
                        value={result.format}
                        readOnly
                        rows={1}
                        placeholder={t("ui.noEquivalent")}
                      />
                      {result.format && (
                        <p className="font-mono text-xs text-muted-foreground whitespace-pre-wrap" dir="ltr" data-testid={`date-format-preview-${id}`}>
                          {renderFormat(result.format, id, previewDate, { utc })}
                        </p>
                      )}
                      {result.warnings.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs text-warning" aria-label={t("ui.warnings", { label })}>
                          {result.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <CopyButton value={result.format} iconOnly label={t("ui.copyFormat", { label })} />
                  </div>
                );
              })}
            </div>
          ) : (
            <PaneEmpty title={t("ui.emptyTitle")} hint={t("ui.emptyHint")} />
          )}
        </EditorPane>
      }
      status={
        translation ? (
          <span>{t(translation.detected ? "ui.readAsDetected" : "ui.readAs", { dialect: DIALECT_LABELS[translation.source] })}</span>
        ) : (
          <span>{t("ui.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }))} />}
    />
  );
}
