import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { formatNumber, useT } from "@/lib/i18n";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { CASE_TYPES, convertToAllCases, slugLines, type SlugSeparator } from "@/utils/case";

const FAQ_KEYS = ["words", "plurals", "acronyms", "many", "slug", "punctuation"] as const;

// Lets a read-only result grow to show every line of a multi-line result.
const fitHeight = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

export function CaseConverter() {
  const t = useT();
  const [input, setInput] = useState("");
  const [keepAcronyms, setKeepAcronyms] = useState(false);
  const [slugSeparator, setSlugSeparator] = useState<SlugSeparator>("-");
  const [slugKeepCase, setSlugKeepCase] = useState(false);
  const [slugMaxLength, setSlugMaxLength] = useState("");
  const text = useDebouncedValue(input);
  const listRef = useRef<HTMLDivElement>(null);

  const outputs = useMemo(() => (text.trim() ? convertToAllCases(text, { keepAcronyms }) : null), [text, keepAcronyms]);
  const maxLength = Math.max(0, Math.floor(Number(slugMaxLength) || 0));
  const slug = useMemo(
    () => (text.trim() ? slugLines(text, { separator: slugSeparator, keepCase: slugKeepCase, maxLength }) : ""),
    [text, slugSeparator, slugKeepCase, maxLength],
  );
  const lineCount = text.split(/\r?\n/).filter((line) => line.trim()).length;

  useEffect(() => {
    listRef.current?.querySelectorAll("textarea").forEach(fitHeight);
  }, [outputs, slug]);

  return (
    <ToolWorkspace
      id="case-converter"
      toolbar={
        <label className="option-switch" htmlFor="case-keep-acronyms">
          {t("option.keepAcronyms")}
          <Switch id="case-keep-acronyms" checked={keepAcronyms} onCheckedChange={setKeepAcronyms} />
        </label>
      }
      first={
        <EditorPane
          title={t("pane.input")}
          htmlFor="case-input"
          scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea
            id="case-input"
            placeholder={t("input.placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.cases")}>
          <div className="result-list" ref={listRef}>
            {CASE_TYPES.map((type) => {
              const value = outputs?.[type] ?? "";
              return (
                <div key={type} className="result-row">
                  <label className="result-row-label" dir="ltr" htmlFor={`case-out-${type}`}>{type}</label>
                  <textarea
                    id={`case-out-${type}`}
                    className="result-row-value code-textarea"
                    dir="ltr"
                    value={value}
                    readOnly
                    rows={1}
                    ref={fitHeight}
                  />
                  <CopyButton value={value} iconOnly label={t("copy.case", { name: type })} />
                </div>
              );
            })}
            <div className="result-row">
              <label className="result-row-label" dir="ltr" htmlFor="case-out-slug">slug</label>
              <textarea id="case-out-slug" className="result-row-value code-textarea" dir="ltr" value={slug} readOnly rows={1} ref={fitHeight} />
              <CopyButton value={slug} iconOnly label={t("copy.case", { name: "slug" })} />
            </div>
            <div className="pane-options">
              <Tabs value={slugSeparator} onValueChange={(v) => setSlugSeparator(v as SlugSeparator)}>
                <TabsList aria-label={t("slug.separator")}>
                  <TabsTrigger value="-">{t("slug.hyphen")}</TabsTrigger>
                  <TabsTrigger value="_">{t("slug.underscore")}</TabsTrigger>
                </TabsList>
              </Tabs>
              <label className="option-switch" htmlFor="case-slug-keep-case">
                {t("slug.keepCase")}
                <Switch id="case-slug-keep-case" checked={slugKeepCase} onCheckedChange={setSlugKeepCase} />
              </label>
              <label className="option-switch" htmlFor="case-slug-max-length">
                {t("slug.maxLength")}
                <Input
                  id="case-slug-max-length"
                  type="number"
                  min={0}
                  placeholder={t("slug.maxPlaceholder")}
                  className="h-7 w-20 text-xs"
                  value={slugMaxLength}
                  onChange={(e) => setSlugMaxLength(e.target.value)}
                />
              </label>
            </div>
          </div>
        </EditorPane>
      }
      status={<span>{lineCount ? t("status.lines", { count: lineCount, n: formatNumber(lineCount) }) : t("status.ready")}</span>}
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
