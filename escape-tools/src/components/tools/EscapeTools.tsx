import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { formatNumber, useT } from "@/lib/i18n";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import {
  convertIdn,
  decodeBackslash,
  decodeHex,
  decodeHtml,
  decodeUnicode,
  encodeBackslash,
  encodeHex,
  encodeHtml,
  encodeUnicode,
  type EscapeResult,
} from "@/utils/escape";

type Mode = "html" | "backslash" | "unicode" | "hex" | "punycode";
type Direction = "encode" | "decode";

const FAQ_KEYS = ["htmlSafe", "backslashUnicode", "hexFormats", "punycode", "urls"] as const;

const MODES: Mode[] = ["html", "backslash", "unicode", "hex", "punycode"];

export function EscapeTools() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("html");
  const [direction, setDirection] = useState<Direction>("encode");
  const [input, setInput] = useState("");
  const [htmlNonAscii, setHtmlNonAscii] = useState(false);
  const [unicodeBraces, setUnicodeBraces] = useState(false);
  const [unicodeAll, setUnicodeAll] = useState(false);
  const [hexSpaced, setHexSpaced] = useState(true);
  const [hexUpper, setHexUpper] = useState(false);
  const text = useDebouncedValue(input);

  const result = useMemo<EscapeResult>(() => {
    if (!text) return { ok: true, value: "" };
    const encode = direction === "encode";
    switch (mode) {
      case "html":
        return encode ? { ok: true, value: encodeHtml(text, { nonAscii: htmlNonAscii }) } : { ok: true, value: decodeHtml(text) };
      case "backslash":
        return encode ? { ok: true, value: encodeBackslash(text) } : decodeBackslash(text);
      case "unicode":
        return encode ? { ok: true, value: encodeUnicode(text, { braces: unicodeBraces, all: unicodeAll }) } : decodeUnicode(text);
      case "hex":
        return encode ? { ok: true, value: encodeHex(text, { spaced: hexSpaced, uppercase: hexUpper }) } : decodeHex(text);
      case "punycode":
        return convertIdn(text, encode ? "toAscii" : "toUnicode");
    }
  }, [text, mode, direction, htmlNonAscii, unicodeBraces, unicodeAll, hexSpaced, hexUpper, t]);

  const output = "value" in result ? result.value : "";
  const error = "error" in result ? result.error : "";
  const encoding = direction === "encode";
  const punycode = mode === "punycode";
  const outputKind = punycode ? (encoding ? "ascii" : "unicode") : encoding ? "escaped" : "unescaped";
  const outputTitle = outputKind === "ascii" ? "ASCII" : outputKind === "unicode" ? "Unicode" : t(`output.${outputKind}`);
  const inputTitle = punycode ? (encoding ? t("input.domain") : t("input.punycodeDomain")) : encoding ? t("input.text") : mode === "hex" ? "Hex" : t("input.escaped");
  const modeLabel = (m: Mode) => (m === "html" ? t("mode.html") : m === "backslash" ? t("mode.backslash") : m === "unicode" ? "Unicode" : m === "hex" ? "Hex" : "Punycode");
  const faqItems = FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }));

  // Move the result into the input and reverse the direction
  const swap = () => {
    setInput(output);
    setDirection(encoding ? "decode" : "encode");
  };

  const option = (id: string, label: string, checked: boolean, onChange: (next: boolean) => void) => (
    <label className="option-switch indent-control" htmlFor={id}>
      {label}
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </label>
  );

  return (
    <ToolWorkspace
      id="escape-tools"
      toolbar={
        <>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList aria-label={t("format.aria")}>
              {MODES.map((m) => (
                <TabsTrigger key={m} value={m}>{modeLabel(m)}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Tabs value={direction} onValueChange={(v) => setDirection(v as Direction)} className="indent-control">
            <TabsList aria-label={t("direction.aria")}>
              <TabsTrigger value="encode">{t("mode.encode")}</TabsTrigger>
              <TabsTrigger value="decode">{t("mode.decode")}</TabsTrigger>
            </TabsList>
          </Tabs>
          {encoding && mode === "html" && option("escape-html-non-ascii", t("option.htmlNonAscii"), htmlNonAscii, setHtmlNonAscii)}
          {encoding && mode === "unicode" && (
            <>
              {option("escape-unicode-braces", t("option.unicodeBraces"), unicodeBraces, setUnicodeBraces)}
              {option("escape-unicode-all", t("option.unicodeAll"), unicodeAll, setUnicodeAll)}
            </>
          )}
          {encoding && mode === "hex" && (
            <>
              {option("escape-hex-spaced", t("option.hexSpaced"), hexSpaced, setHexSpaced)}
              {option("escape-hex-upper", t("option.hexUpper"), hexUpper, setHexUpper)}
            </>
          )}
          <button type="button" className="toolbar-text-button" onClick={swap} disabled={!output}>
            {t("action.swap")}
          </button>
        </>
      }
      notice={error ? <div className="workspace-notice" data-tone="error" role="alert">{error}</div> : undefined}
      first={
        <EditorPane
          title={inputTitle}
          htmlFor="escape-input"
          scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea id="escape-input" placeholder={t(`placeholder.${mode}.${direction}`)} value={input} onChange={(e) => setInput(e.target.value)} />
        </EditorPane>
      }
      second={
        <EditorPane
          title={outputTitle}
          htmlFor={output ? "escape-output" : undefined}
          scroll={false}
          actions={<CopyButton value={output} label={t("common.copy")} ariaLabel={t(`copy.${outputKind}`)} />}
        >
          {output ? <CodeTextarea id="escape-output" value={output} readOnly /> : <PaneEmpty title={t(`empty.${outputKind}`)} />}
        </EditorPane>
      }
      status={
        error ? (
          <span className="text-destructive">{t("status.invalid")}</span>
        ) : output ? (
          <span>{t("status.chars", { input: formatNumber(text.length), count: output.length })}</span>
        ) : (
          <span>{t("status.ready")}</span>
        )
      }
      help={<ToolFaqSection items={faqItems} />}
    />
  );
}
