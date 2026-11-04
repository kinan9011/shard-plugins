import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMemo, useState } from "react";
import { ScanText, TriangleAlert } from "lucide-react";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { formatList, formatNumber, useT, type TKey } from "@/lib/i18n";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import {
  findNormalizationVariants,
  getNormalizedForms,
  getStringStats,
  inspectCharacters,
  stripFlaggedCharacters,
  type CharFlag,
  type CharInfo,
  type LineEnding,
} from "@/utils/string-inspector";

const CHAR_LIMIT = 500;

const FAQ_SLUGS = ["graphemes", "flagged", "names", "normalization", "lookalike"] as const;

const FLAG_KEY: Record<CharFlag, TKey> = {
  invisible: "flag.invisible",
  control: "flag.control",
  bidi: "flag.bidi",
};

const CATEGORY_KEY: Record<CharInfo["category"], TKey> = {
  letter: "category.letter",
  mark: "category.mark",
  digit: "category.digit",
  number: "category.number",
  punctuation: "category.punctuation",
  symbol: "category.symbol",
  emoji: "category.emoji",
  whitespace: "category.whitespace",
  control: "category.control",
  format: "category.format",
  surrogate: "category.surrogate",
  "private use": "category.privateUse",
  unassigned: "category.unassigned",
};

const LINE_ENDING_KEY: Record<LineEnding, TKey | null> = {
  none: "lineEnding.none",
  LF: null,
  CRLF: null,
  CR: null,
  mixed: "lineEnding.mixed",
};
// The system names stay as they are.
const LINE_ENDING_NAME: Partial<Record<LineEnding, string>> = { LF: "LF (Unix)", CRLF: "CRLF (Windows)", CR: "CR (classic Mac)" };

function CharRow({ info }: { info: CharInfo }) {
  const t = useT();
  return (
    <div
      role="row"
      className={`grid grid-cols-[4.5rem_5.5rem_1fr_auto] items-center gap-3 border-b border-border/50 px-4 py-1.5 text-xs ${info.flag ? "bg-warning/10" : ""}`}
    >
      <span role="cell" className={`truncate font-mono ${info.display !== info.char ? "text-2xs text-muted-foreground" : "text-sm"}`}>
        {info.display}
      </span>
      <span role="cell" dir="ltr" className="font-mono text-start">{info.hex}</span>
      <span role="cell" className="min-w-0">
        <span className="block truncate">
          {info.flag && <span className="me-1 font-medium text-warning">{t(FLAG_KEY[info.flag])}</span>}
          {info.label ?? t(CATEGORY_KEY[info.category])}
        </span>
        <span className="block text-2xs text-muted-foreground">
          <span dir="ltr" className="font-mono">{info.utf8}</span>
          {info.flag && ` · ${t("char.firstAt", { line: formatNumber(info.firstLine), column: formatNumber(info.firstColumn) })}`}
        </span>
      </span>
      <span role="cell" dir="ltr" className="text-end font-mono text-muted-foreground">×{formatNumber(info.count)}</span>
    </div>
  );
}

export function StringInspector() {
  const t = useT();
  const [input, setInput] = useState("");
  const text = useDebouncedValue(input);

  const result = useMemo(() => {
    if (!text) return null;
    return { stats: getStringStats(text), chars: inspectCharacters(text, CHAR_LIMIT) };
    // `t` is a dependency because the character names are translated while they are described.
  }, [text, t]);

  const normalization = useMemo(
    () => (text ? { forms: getNormalizedForms(text), check: findNormalizationVariants(text) } : null),
    [text],
  );
  const variants = normalization?.check.variants ?? [];

  const cleaned = useMemo(() => (result?.chars.flaggedCount ? stripFlaggedCharacters(text) : ""), [result, text]);

  const count = (key: "count.character" | "count.codePoint" | "count.utf16Unit" | "count.byte", n: number) => t(key, { count: n, n: formatNumber(n) });

  const statRows: [string, string][] = result
    ? [
        [t("stat.characters"), formatNumber(result.stats.graphemes)],
        [t("stat.utf16"), formatNumber(result.stats.codeUnits)],
        [t("stat.codePoints"), formatNumber(result.stats.codePoints)],
        [t("stat.bytes"), formatNumber(result.stats.bytes)],
        [t("stat.words"), formatNumber(result.stats.words)],
        [t("stat.lines"), formatNumber(result.stats.lines)],
        [t("stat.sentences"), formatNumber(result.stats.sentences)],
        [t("stat.whitespace"), formatNumber(result.stats.whitespace)],
        [
          t("stat.longestLine"),
          t("stat.longestLineValue", { length: count("count.character", result.stats.longestLine), line: formatNumber(result.stats.longestLineNumber) }),
        ],
        [t("stat.lineEndings"), LINE_ENDING_KEY[result.stats.lineEnding] ? t(LINE_ENDING_KEY[result.stats.lineEnding]!) : LINE_ENDING_NAME[result.stats.lineEnding]!],
      ]
    : [];

  const andMore = (items: string[], more: number) => {
    const list = formatList(items, "unit");
    return more > 0 ? t("list.andMore", { list, n: formatNumber(more) }) : list;
  };

  const statsJson = result ? JSON.stringify(result.stats, null, 2) : "";
  const flagged = result?.chars.flagged ?? [];

  return (
    <ToolWorkspace
      id="string-inspector"
      toolbar={
        <>
          <CopyButton value={statsJson} label={t("copy.stats")} />
          {cleaned && <CopyButton value={cleaned} label={t("copy.cleaned")} />}
        </>
      }
      first={
        <EditorPane
          title={t("pane.text")}
          htmlFor="string-inspector-input"
          scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea
            id="string-inspector-input"
            placeholder={t("input.placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.inspection")}>
          {result ? (
            <div className="result-list">
              {flagged.length > 0 && (
                <div className="pane-options text-warning" role="status">
                  <TriangleAlert size={14} aria-hidden="true" />
                  <span>
                    {t("flagged.found", {
                      count: result.chars.flaggedCount,
                      n: formatNumber(result.chars.flaggedCount),
                      list: andMore(
                        flagged.slice(0, 6).map((c) => `${c.abbr ?? c.hex} ×${formatNumber(c.count)}`),
                        flagged.length - 6,
                      ),
                    })}
                  </span>
                </div>
              )}
              {variants.length > 0 && (
                <div className="pane-options text-warning" role="status">
                  <TriangleAlert size={14} aria-hidden="true" />
                  <span>
                    {t("variants.found", {
                      count: variants.length,
                      n: formatNumber(variants.length),
                      list: andMore(
                        variants.slice(0, 3).map((v) => `${v.nfc} (${formatList(v.spellings.map((cps) => cps.join(" ")), "disjunction")})`),
                        variants.length - 3,
                      ),
                    })}{" "}
                    {t("variants.hint")}
                  </span>
                </div>
              )}
              {statRows.map(([label, value]) => (
                <div key={label} className="result-row">
                  <span className="result-row-label">{label}</span>
                  <span className="result-row-value">{value}</span>
                  <span />
                </div>
              ))}
              <div className="pane-options">
                <span className="font-medium">{t("norm.title")}</span>
              </div>
              {normalization?.check.truncated && (
                <div className="pane-options text-muted-foreground">
                  {t("norm.truncated", { count: normalization.check.checked, n: formatNumber(normalization.check.checked) })}
                </div>
              )}
              {normalization?.forms.map((f) => (
                <div key={f.form} className="result-row">
                  <span className="result-row-label">{f.form}</span>
                  <span className="result-row-value">
                    {t("norm.detail", {
                      state: f.same ? t("norm.same") : t("norm.differs"),
                      codePoints: count("count.codePoint", f.codePoints),
                      units: count("count.utf16Unit", f.codeUnits),
                      bytes: count("count.byte", f.bytes),
                    })}
                  </span>
                  <CopyButton value={f.value} iconOnly label={t("norm.copy", { form: f.form })} />
                </div>
              ))}
              <div className="pane-options">
                <span className="font-medium" id="string-inspector-chars">
                  {t("chars.title", { n: formatNumber(result.chars.distinct) })}
                </span>
              </div>
              {result.chars.truncated && (
                <div className="pane-options text-muted-foreground">
                  {t("chars.truncated", { limit: formatNumber(CHAR_LIMIT) })}
                </div>
              )}
              <div role="table" aria-labelledby="string-inspector-chars">
                {result.chars.chars.map((info) => (
                  <CharRow key={info.codePoint} info={info} />
                ))}
              </div>
            </div>
          ) : (
            <PaneEmpty
              icon={<ScanText size={20} aria-hidden="true" />}
              title={t("empty.title")}
              hint={t("empty.hint")}
            />
          )}
        </EditorPane>
      }
      status={
        result ? (
          <>
            <span>{count("count.character", result.stats.graphemes)}</span>
            <span>{count("count.byte", result.stats.bytes)}</span>
            {result.chars.flaggedCount > 0 ? (
              <span className="text-warning">{t("status.flagged", { n: formatNumber(result.chars.flaggedCount) })}</span>
            ) : (
              <span className="text-success">{t("status.clean")}</span>
            )}
          </>
        ) : (
          <span>{t("status.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_SLUGS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }))} />}
    />
  );
}
