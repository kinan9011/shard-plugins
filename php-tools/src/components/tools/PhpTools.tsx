import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { formatNumber, useT } from "@/lib/i18n";
import { jsonToPhpArray, jsonToSerialized, phpArrayToJson, unserializeToJson, type PhpResult } from "@/utils/php";

type Format = "serialized" | "array";
type Direction = "to-json" | "from-json";

const FAQ_KEYS = ["repair", "objects", "input", "order", "session"] as const;

const FORMATS: Format[] = ["serialized", "array"];

export function PhpTools() {
  const t = useT();
  const [format, setFormat] = useState<Format>("serialized");
  const [direction, setDirection] = useState<Direction>("to-json");
  const [input, setInput] = useState("");
  const [longSyntax, setLongSyntax] = useState(false);
  const text = useDebouncedValue(input);

  const result = useMemo<PhpResult>(() => {
    if (!text.trim()) return { ok: true, value: "" };
    if (format === "serialized") return direction === "to-json" ? unserializeToJson(text) : jsonToSerialized(text);
    return direction === "to-json" ? phpArrayToJson(text) : jsonToPhpArray(text, { longSyntax });
  }, [text, format, direction, longSyntax, t]);

  const output = "value" in result ? result.value : "";
  const error = "error" in result ? result.error : "";
  const notice = "notice" in result ? result.notice : undefined;
  const toJson = direction === "to-json";
  const sourceTitle = format === "serialized" ? t("title.serialized") : t("title.phpArray");
  const inputTitle = toJson ? sourceTitle : "JSON";
  const outputTitle = toJson ? "JSON" : sourceTitle;

  const placeholder = toJson ? t(format === "serialized" ? "placeholder.serialized" : "placeholder.phpArray") : t("placeholder.json");

  // Move the result into the input and reverse the direction
  const swap = () => {
    setInput(output);
    setDirection(toJson ? "from-json" : "to-json");
  };

  return (
    <ToolWorkspace
      id="php-tools"
      toolbar={
        <>
          <Tabs value={format} onValueChange={(v) => setFormat(v as Format)}>
            <TabsList aria-label={t("format.label")}>
              {FORMATS.map((f) => (
                <TabsTrigger key={f} value={f}>{t(f === "serialized" ? "format.serialized" : "format.array")}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Tabs value={direction} onValueChange={(v) => setDirection(v as Direction)} className="indent-control">
            <TabsList aria-label={t("direction.label")}>
              <TabsTrigger value="to-json">{t("direction.toJson")}</TabsTrigger>
              <TabsTrigger value="from-json">{t("direction.fromJson")}</TabsTrigger>
            </TabsList>
          </Tabs>
          {format === "array" && !toJson && (
            <label className="option-switch indent-control" htmlFor="php-long-syntax">
              {t("option.longSyntax")}
              <Switch id="php-long-syntax" checked={longSyntax} onCheckedChange={setLongSyntax} />
            </label>
          )}
          <button type="button" className="toolbar-text-button" onClick={swap} disabled={!output}>
            {t("action.swap")}
          </button>
        </>
      }
      notice={
        error ? (
          <div className="workspace-notice" data-tone="error" role="alert">{error}</div>
        ) : notice ? (
          <div className="workspace-notice" role="status">{notice}</div>
        ) : undefined
      }
      first={
        <EditorPane
          title={inputTitle}
          htmlFor="php-input"
          scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea id="php-input" placeholder={placeholder} value={input} onChange={(e) => setInput(e.target.value)} />
        </EditorPane>
      }
      second={
        <EditorPane
          title={outputTitle}
          htmlFor={output ? "php-output" : undefined}
          scroll={false}
          actions={<CopyButton value={output} label={t("common.copy")} ariaLabel={t("copy.title", { title: outputTitle })} />}
        >
          {output ? <CodeTextarea id="php-output" value={output} readOnly /> : <PaneEmpty title={t("empty.title", { title: outputTitle })} />}
        </EditorPane>
      }
      status={
        error ? (
          <span className="text-destructive">{t("status.invalid")}</span>
        ) : output ? (
          <span>{t("status.sizes", { input: formatNumber(text.length), count: output.length, output: formatNumber(output.length) })}</span>
        ) : (
          <span>{t("status.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
