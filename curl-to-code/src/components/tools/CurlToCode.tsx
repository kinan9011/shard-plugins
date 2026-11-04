import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMemo, useState } from "react";
import { Terminal } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { formatList, useT } from "@/lib/i18n";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import {
  CODE_TARGETS,
  describeBody,
  generateCode,
  parseCurl,
  type CodeTarget,
  type CurlRequest,
} from "@/utils/curl-to-code";

const FAQ_KEYS = ["commands", "flags", "files", "secrets"] as const;

const PLACEHOLDER = `curl -X POST https://api.example.com/v1/items \\
  -H 'Authorization: Bearer <token>' \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Widget","price":9.99}'`;

const SECRET_HEADER = /authorization|cookie|token|api[-_]?key|secret|session|password/i;
const SECRET_QUERY = /[?&][^=&]*(token|key|secret|signature|sig|password)[^=&]*=/i;

const hasSecrets = (req: CurlRequest) =>
  Boolean(req.auth) || req.headers.some(([name]) => SECRET_HEADER.test(name)) || SECRET_QUERY.test(req.url);

const shortUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
};

export function CurlToCode() {
  const t = useT();
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<CodeTarget>("javascript");
  const [rustAsync, setRustAsync] = useState(false);
  const command = useDebouncedValue(input);

  const parsed = useMemo(() => {
    if (!command.trim()) return null;
    try {
      return { request: parseCurl(command), error: "" };
    } catch (error) {
      return { request: null, error: error instanceof Error ? error.message : t("error.read") };
    }
  }, [command, t]);

  const current = input.trim() ? parsed : null;
  const request = current?.request ?? null;
  const code = useMemo(() => (request ? generateCode(request, target, { rustAsync }) : ""), [request, target, rustAsync]);
  const targetLabel = CODE_TARGETS.find((item) => item.value === target)?.label ?? t("pane.code");

  const notes = request
    ? [
        ...request.notes,
        ...(request.ignoredFlags.length ? [t("note.ignoredFlags", { flags: formatList(request.ignoredFlags, "unit") })] : []),
        ...(request.unknownFlags.length ? [t("note.unknownFlags", { flags: formatList(request.unknownFlags, "unit") })] : []),
      ]
    : [];

  const status = () => {
    if (current?.error) return <span className="text-destructive">{t("status.invalid")}</span>;
    if (!request) return <span>{t("status.ready")}</span>;
    const headerCount = request.headers.length + (request.auth ? 1 : 0);
    return (
      <>
        <span>{request.method}</span>
        <span className="min-w-0 truncate" dir="ltr" title={request.url}>{shortUrl(request.url)}</span>
        <span>{t("status.headers", { count: headerCount })}</span>
        <span>{describeBody(request.body)}</span>
      </>
    );
  };

  return (
    <ToolWorkspace
      id="curl-to-code"
      toolbar={
        <>
          <Tabs value={target} onValueChange={(v) => setTarget(v as CodeTarget)}>
            <TabsList aria-label={t("target.label")}>
              {CODE_TARGETS.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {target === "rust" && (
            <label className="option-switch indent-control" htmlFor="curl-to-code-rust-async">
              {t("option.async")}
              <Switch id="curl-to-code-rust-async" checked={rustAsync} onCheckedChange={setRustAsync} />
            </label>
          )}
        </>
      }
      notice={
        current?.error ? (
          <div className="workspace-notice" data-tone="error" role="alert">{current.error}</div>
        ) : request && (notes.length > 0 || hasSecrets(request)) ? (
          <>
            {notes.map((note) => (
              <div key={note} className="workspace-notice">{note}</div>
            ))}
            {hasSecrets(request) && (
              <div className="workspace-notice text-muted-foreground">
                {t("note.secrets")}
              </div>
            )}
          </>
        ) : undefined
      }
      first={
        <EditorPane
          title={t("pane.command")}
          htmlFor="curl-to-code-input"
          scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea
            id="curl-to-code-input"
            wrap="off"
            placeholder={PLACEHOLDER}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane
          title={targetLabel}
          htmlFor={code ? "curl-to-code-output" : undefined}
          scroll={false}
          actions={<CopyButton value={code} label={t("copy.code", { target: targetLabel })} />}
        >
          {code ? (
            <CodeTextarea id="curl-to-code-output" wrap="off" value={code} readOnly />
          ) : (
            <PaneEmpty
              icon={<Terminal size={20} aria-hidden="true" />}
              title={t("empty.title", { target: targetLabel })}
              hint={t("empty.hint")}
            />
          )}
        </EditorPane>
      }
      status={status()}
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
