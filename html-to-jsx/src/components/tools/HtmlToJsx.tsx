import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { formatNumber, useT } from "@/lib/i18n";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { htmlToJsx, type HtmlToJsxResult } from "@/utils/html-to-jsx";

const FAQ_SLUGS = ["noRun", "events", "defaultValue", "whitespace"] as const;

const PLACEHOLDER = '<div class="card" style="margin-top: 8px">\n  <label for="email">Email</label>\n  <input id="email" type="email" required>\n  <button onclick="send()">Send</button>\n</div>';

const lineCount = (text: string) => (text ? text.split("\n").length : 0);

export function HtmlToJsx() {
  const t = useT();
  const [input, setInput] = useState("");
  const [component, setComponent] = useState(false);
  const [componentName, setComponentName] = useState("Component");

  const job = useMemo(() => ({ input, component, componentName }), [input, component, componentName]);
  const pending = useDebouncedValue(job);

  const result = useMemo<HtmlToJsxResult>(
    () => htmlToJsx(pending.input, { component: pending.component, componentName: pending.componentName }),
    // `t` is a dependency because the error message is translated when it is created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, t],
  );

  const output = "value" in result ? result.value : "";
  const error = "error" in result ? result.error : "";

  return (
    <ToolWorkspace
      id="html-to-jsx"
      toolbar={
        <>
          <label className="option-switch" htmlFor="html-to-jsx-component">
            {t("option.component")}
            <Switch id="html-to-jsx-component" checked={component} onCheckedChange={setComponent} />
          </label>
          {component && (
            <label className="indent-control" htmlFor="html-to-jsx-name">
              {t("option.name")}
              <Input
                id="html-to-jsx-name"
                className="h-7 w-40 text-xs"
                value={componentName}
                dir="ltr"
                spellCheck={false}
                onChange={(e) => setComponentName(e.target.value)}
              />
            </label>
          )}
        </>
      }
      notice={error ? <div className="workspace-notice" data-tone="error" role="alert">{error}</div> : undefined}
      first={
        <EditorPane
          title={t("pane.html")}
          htmlFor="html-to-jsx-input"
          scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea id="html-to-jsx-input" wrap="off" placeholder={PLACEHOLDER} value={input} onChange={(e) => setInput(e.target.value)} />
        </EditorPane>
      }
      second={
        <EditorPane
          title={t("pane.jsx")}
          htmlFor={output ? "html-to-jsx-output" : undefined}
          scroll={false}
          actions={<CopyButton value={output} label={t("copy.jsx")} />}
        >
          {output ? (
            <CodeTextarea id="html-to-jsx-output" wrap="off" value={output} readOnly />
          ) : (
            <PaneEmpty title={t("empty.title")} hint={t("empty.hint")} />
          )}
        </EditorPane>
      }
      status={
        error ? (
          <span className="text-destructive">{t("status.invalidName")}</span>
        ) : output ? (
          <>
            <span>{t("status.lines", { count: lineCount(output), n: formatNumber(lineCount(output)) })}</span>
            {"handlers" in result && result.handlers > 0 && (
              <span>{t("status.handlers", { count: result.handlers, n: formatNumber(result.handlers) })}</span>
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
