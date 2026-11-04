import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { formatNumber, useT } from "@/lib/i18n";
import { MAX_COUNT, formatItems, generateItems, type LoremFormat, type LoremKind } from "@/utils/lorem";

const FAQ_KEYS = ["kinds", "real", "unique", "paste", "regenerate"] as const;

const KINDS: LoremKind[] = ["paragraphs", "sentences", "words", "titles", "names", "emails", "urls"];

const DEFAULT_COUNTS: Record<LoremKind, number> = {
  paragraphs: 3,
  sentences: 5,
  words: 50,
  titles: 10,
  names: 10,
  emails: 10,
  urls: 10,
};

const LOREM_KINDS = new Set<LoremKind>(["paragraphs", "sentences", "words"]);

const parseCount = (text: string, fallback: number) => {
  const value = Number.parseInt(text, 10);
  return Number.isNaN(value) ? fallback : Math.min(Math.max(value, 1), MAX_COUNT);
};

export function LoremGenerator() {
  const t = useT();
  const [kind, setKind] = useState<LoremKind>("paragraphs");
  const [countText, setCountText] = useState<Record<LoremKind, string>>(
    () => Object.fromEntries(Object.entries(DEFAULT_COUNTS).map(([k, v]) => [k, String(v)])) as Record<LoremKind, string>,
  );
  const [format, setFormat] = useState<LoremFormat>("text");
  const [startWithLorem, setStartWithLorem] = useState(true);
  const [nonce, setNonce] = useState(0);

  const count = parseCount(countText[kind], DEFAULT_COUNTS[kind]);
  const lorem = LOREM_KINDS.has(kind);

  const output = useMemo(
    () => formatItems(generateItems(kind, count, { startWithLorem: lorem && startWithLorem }), kind, format),
    // The nonce makes Regenerate draw a new list with the same options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, count, startWithLorem, lorem, format, nonce],
  );

  const setCount = (value: string) => setCountText((current) => ({ ...current, [kind]: value }));

  return (
    <ToolWorkspace
      id="lorem-generator"
      toolbar={
        <>
          <Tabs value={kind} onValueChange={(v) => setKind(v as LoremKind)}>
            <TabsList aria-label={t("kind.label")}>
              {KINDS.map((k) => (
                <TabsTrigger key={k} value={k}>{t(`kind.${k}`)}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <button type="button" className="toolbar-text-button indent-control" onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw size={14} aria-hidden="true" />
            {t("action.regenerate")}
          </button>
        </>
      }
      first={
        <EditorPane title={t("pane.options")}>
          <div className="pane-options">
            <label htmlFor="lorem-count" className="w-20 font-medium">{t("option.count")}</label>
            <Input
              id="lorem-count"
              type="number"
              min={1}
              max={MAX_COUNT}
              className="h-7 w-20 text-xs"
              value={countText[kind]}
              onChange={(e) => setCount(e.target.value)}
              onBlur={() => setCount(String(count))}
            />
            <span className="text-muted-foreground">{t(`range.${kind}`, { max: formatNumber(MAX_COUNT) })}</span>
          </div>
          <div className="pane-options">
            <span className="w-20 font-medium">{t("option.format")}</span>
            <Tabs value={format} onValueChange={(v) => setFormat(v as LoremFormat)}>
              <TabsList aria-label={t("option.format")}>
                <TabsTrigger value="text">{t("format.text")}</TabsTrigger>
                <TabsTrigger value="json">{t("format.json")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {lorem && (
            <div className="pane-options">
              <label className="option-switch" htmlFor="lorem-start">
                {t("option.startLorem")}
                <Switch id="lorem-start" checked={startWithLorem} onCheckedChange={setStartWithLorem} />
              </label>
            </div>
          )}
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.output")} htmlFor="lorem-output" scroll={false} actions={<CopyButton value={output} label={t("copy.all")} />}>
          <CodeTextarea id="lorem-output" value={output} readOnly />
        </EditorPane>
      }
      status={
        <>
          <span>{t(`count.${kind}`, { count, total: formatNumber(count) })}</span>
          <span>{t("status.characters", { count: output.length, total: formatNumber(output.length) })}</span>
        </>
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
