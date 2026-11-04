import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMemo, useState } from "react";
import { ChevronDown, ShieldCheck, TriangleAlert } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { formatNumber, useT, type TKey } from "@/lib/i18n";
import {
  DETECTORS,
  defaultDetectorSettings,
  getDetector,
  redactText,
  restorePlaceholders,
  type DetectorGroup,
  type DetectorId,
  type DetectorSettings,
  type MaskStyle,
} from "@/utils/secret-redactor";

const FAQ_KEYS = ["coverage", "style", "restore", "defaults"] as const;

const STYLES: { value: MaskStyle; label: TKey }[] = [
  { value: "label", label: "style.label" },
  { value: "partial", label: "style.partial" },
  { value: "placeholder", label: "style.placeholder" },
];

const GROUPS: { id: DetectorGroup; label: TKey }[] = [
  { id: "keys", label: "group.keys" },
  { id: "credentials", label: "group.credentials" },
  { id: "personal", label: "group.personal" },
  { id: "heuristic", label: "group.heuristic" },
];

export function SecretRedactor() {
  const t = useT();
  const [input, setInput] = useState("");
  const [style, setStyle] = useState<MaskStyle>("placeholder");
  const [detectors, setDetectors] = useState<DetectorSettings>(defaultDetectorSettings);
  const [keepPrivateIps, setKeepPrivateIps] = useState(true);
  const [showDetectors, setShowDetectors] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const [reply, setReply] = useState("");
  const text = useDebouncedValue(input);
  const replyText = useDebouncedValue(reply);

  const result = useMemo(() => (text ? redactText(text, { detectors, keepPrivateIps, style }) : null), [text, detectors, keepPrivateIps, style, t]);

  const restored = useMemo(
    () => (result && style === "placeholder" && replyText ? restorePlaceholders(replyText, result.mapping) : null),
    [result, style, replyText],
  );

  const enabledCount = DETECTORS.filter((d) => detectors[d.id]).length;
  const setDetector = (id: DetectorId, on: boolean) => setDetectors((current) => ({ ...current, [id]: on }));

  const option = (id: string, label: string, checked: boolean, onChange: (next: boolean) => void, disabled = false) => (
    <label key={id} className="option-switch" htmlFor={id}>
      {label}
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );

  const detectorPanel = showDetectors ? (
    <div id="secret-redactor-detectors" className="flex flex-col" role="group" aria-label={t("detectors.aria")}>
      {GROUPS.map((group) => (
        <div key={group.id} className="pane-options">
          <span className="w-24 shrink-0 text-2xs font-medium text-muted-foreground">{t(group.label)}</span>
          {DETECTORS.filter((d) => d.group === group.id).map((d) =>
            option(`secret-redactor-${d.id}`, d.label, detectors[d.id], (on) => setDetector(d.id, on)),
          )}
          {group.id === "personal" &&
            option("secret-redactor-keep-private-ips", t("option.keepPrivateIps"), keepPrivateIps, setKeepPrivateIps, !detectors["ip-address"])}
        </div>
      ))}
    </div>
  ) : undefined;

  const placeholderMode = style === "placeholder";

  return (
    <ToolWorkspace
      id="secret-redactor"
      toolbar={
        <>
          <Tabs value={style} onValueChange={(v) => setStyle(v as MaskStyle)}>
            <TabsList aria-label={t("style.aria")}>
              {STYLES.map((s) => (
                <TabsTrigger key={s.value} value={s.value}>{t(s.label)}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <button
            type="button"
            className="toolbar-text-button"
            aria-expanded={showDetectors}
            aria-controls="secret-redactor-detectors"
            onClick={() => setShowDetectors((open) => !open)}
          >
            <ChevronDown size={14} aria-hidden="true" className={showDetectors ? "rotate-180" : undefined} />
            {t("detectors.toggle", { enabled: enabledCount, total: DETECTORS.length })}
          </button>
        </>
      }
      notice={detectorPanel}
      first={
        <EditorPane
          title={t("pane.input")}
          htmlFor="secret-redactor-input"
          scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea
            id="secret-redactor-input"
            placeholder={t("input.placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane
          title={t("pane.output")}
          htmlFor={result ? "secret-redactor-output" : undefined}
          scroll={false}
          actions={<CopyButton value={result?.output ?? ""} label={t("copy.redacted")} />}
        >
          {result ? (
            <>
              <CodeTextarea id="secret-redactor-output" value={result.output} readOnly />
              <div className="max-h-[55%] shrink-0 overflow-auto border-t border-border">
                <div className="result-list">
                  <div className="pane-options">
                    <span className="font-medium" id="secret-redactor-findings">{t("findings.title")}</span>
                  </div>
                  {result.findings.length === 0 ? (
                    <div className="pane-options text-muted-foreground">
                      {t("findings.none")}
                    </div>
                  ) : (
                    <div role="table" aria-labelledby="secret-redactor-findings">
                      {result.findings.map((f) => (
                        <div key={f.detector} className="result-row" role="row">
                          <span className="result-row-label" role="cell">{f.label}</span>
                          <span className="result-row-value" role="cell">×{formatNumber(f.count)}</span>
                          <span className="text-xs text-muted-foreground" role="cell">{t("findings.firstLine", { line: formatNumber(f.firstLine) })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {placeholderMode && result.mapping.length > 0 && (
                  <div className="result-list">
                    <div className="pane-options">
                      <span className="font-medium" id="secret-redactor-map">{t("map.title")}</span>
                      {option("secret-redactor-show-values", t("map.showValues"), showValues, setShowValues)}
                    </div>
                    <div className="pane-options text-muted-foreground">
                      <ShieldCheck size={14} aria-hidden="true" />
                      <span>{t("map.local")}</span>
                    </div>
                    <div role="table" aria-labelledby="secret-redactor-map">
                      {result.mapping.map((m) => (
                        <div key={m.placeholder} className="result-row" role="row">
                          <span className="result-row-label font-mono" role="cell" dir="ltr">{m.placeholder}</span>
                          <span className="result-row-value" role="cell" dir="ltr">
                            {showValues ? m.original : "•".repeat(Math.min(m.original.length, 12))}
                          </span>
                          <span className="text-2xs text-muted-foreground" role="cell">{getDetector(m.detector).tag}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="result-list">
                  <div className="pane-options">
                    <label className="font-medium" htmlFor="secret-redactor-reply">{t("restore.title")}</label>
                    {restored && <CopyButton value={restored.output} label={t("copy.restored")} />}
                  </div>
                  {placeholderMode ? (
                    <>
                      <div className="flex h-28 flex-col border-b border-border/50">
                        <CodeTextarea
                          id="secret-redactor-reply"
                          placeholder={t("restore.placeholder")}
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                        />
                      </div>
                      {restored && (
                        <>
                          <div className="pane-options text-muted-foreground" role="status">
                            {t("restore.status", { count: restored.restored, number: formatNumber(restored.restored) })}
                            {restored.unknown.length > 0 && (
                              <span className="inline-flex items-center gap-1 text-warning">
                                <TriangleAlert size={14} aria-hidden="true" />
                                {restored.unknown.length > 4
                                  ? t("restore.unknownMore", { list: restored.unknown.slice(0, 4).join(", "), more: formatNumber(restored.unknown.length - 4) })
                                  : t("restore.unknown", { list: restored.unknown.join(", ") })}
                              </span>
                            )}
                          </div>
                          <div className="flex h-28 flex-col">
                            <CodeTextarea id="secret-redactor-restored" aria-label={t("restore.aria")} value={restored.output} readOnly />
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="pane-options text-muted-foreground">{t("restore.hint")}</div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <PaneEmpty
              icon={<ShieldCheck size={20} aria-hidden="true" />}
              title={t("empty.title")}
              hint={t("empty.hint")}
            />
          )}
        </EditorPane>
      }
      status={
        result ? (
          result.total > 0 ? (
            <span>
              {t("status.items", { count: result.total, number: formatNumber(result.total) })} · {t("status.types", { count: result.types, number: formatNumber(result.types) })}
            </span>
          ) : (
            <span>{t("status.none")}</span>
          )
        ) : (
          <span>{t("status.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }))} />}
    />
  );
}
