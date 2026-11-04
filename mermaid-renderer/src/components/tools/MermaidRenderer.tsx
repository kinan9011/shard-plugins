import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { CopyButton } from "@/components/tools/CopyButton";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { saveFile } from "@/lib/desktop";
import { useT } from "@/lib/i18n";
import { errorSummary, renderMermaid, svgDataUrl, svgToPng, type MermaidDiagram } from "@/utils/mermaid-render";
import { MERMAID_TEMPLATES } from "@/utils/mermaid-templates";

type Theme = "light" | "dark";

/** The page color behind the diagram, in the preview and in PNG files. It matches Mermaid's theme. */
const BACKGROUNDS: Record<Theme, string> = { light: "#ffffff", dark: "#333333" };

const ZOOMS = [50, 75, 100, 150, 200];

const FAQ_KEYS = ["types", "safe", "html", "colors", "pngSize"] as const;

const initialTheme = (): Theme =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";

export function MermaidRenderer() {
  const t = useT();
  const [input, setInput] = useState<string>(MERMAID_TEMPLATES[0].source);
  const [replaced, setReplaced] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [zoom, setZoom] = useState<number | null>(null);
  const [diagram, setDiagram] = useState<MermaidDiagram | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const source = useDebouncedValue(input, 300);

  useEffect(() => {
    if (!source.trim()) {
      setDiagram(null);
      setError("");
      return;
    }
    let current = true;
    renderMermaid(source, theme === "dark").then(
      (result) => {
        if (!current) return;
        setDiagram(result);
        setError("");
      },
      (reason: unknown) => {
        if (current) setError(errorSummary(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [source, theme]);

  const edit = (text: string) => {
    setInput(text);
    setReplaced(null);
  };

  const applyTemplate = (id: string) => {
    const template = MERMAID_TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    const isTemplate = MERMAID_TEMPLATES.some((item) => item.source === input);
    // Keep the user's own text so the replacement can be undone
    setReplaced(input.trim() && !isTemplate ? input : null);
    setInput(template.source);
  };

  const save = async (kind: "svg" | "png") => {
    if (!diagram) return;
    setSaveError("");
    try {
      const blob =
        kind === "svg" ? new Blob([diagram.svg], { type: "image/svg+xml" }) : await svgToPng(diagram, 2, BACKGROUNDS[theme]);
      await saveFile(blob, `diagram.${kind}`);
    } catch {
      setSaveError(t("error.save", { kind: kind.toUpperCase() }));
    }
  };

  const notice = error ? (
    <div className="workspace-notice" data-tone="error" role="alert">
      <p className="mb-1 text-xs">{t("error.lead")}</p>
      <pre dir="ltr" className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
      {diagram && <p className="mt-1 text-xs">{t("error.lastDiagram")}</p>}
    </div>
  ) : saveError ? (
    <div className="workspace-notice" data-tone="error" role="alert">{saveError}</div>
  ) : undefined;

  return (
    <ToolWorkspace
      id="mermaid-renderer"
      wrapToolbar
      toolbar={
        <>
          <select
            aria-label={t("toolbar.template")}
            className="h-8 rounded-md border border-input bg-background ps-2 pe-7 text-sm text-foreground"
            value=""
            onChange={(event) => applyTemplate(event.target.value)}
          >
            <option value="" disabled>
              {t("toolbar.templatePlaceholder")}
            </option>
            {MERMAID_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {t(`template.${template.id}`)}
              </option>
            ))}
          </select>
          {replaced !== null && (
            <button type="button" className="toolbar-text-button" onClick={() => edit(replaced)}>
              {t("toolbar.undoTemplate")}
            </button>
          )}
          <div className="layout-switch indent-control" role="group" aria-label={t("toolbar.themeAria")}>
            <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
              <Sun size={14} aria-hidden="true" />
              {t("toolbar.light")}
            </button>
            <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
              <Moon size={14} aria-hidden="true" />
              {t("toolbar.dark")}
            </button>
          </div>
          <select
            aria-label={t("toolbar.zoom")}
            className="h-8 rounded-md border border-input bg-background ps-2 pe-7 text-sm text-foreground"
            value={zoom ?? "fit"}
            onChange={(event) => setZoom(event.target.value === "fit" ? null : Number(event.target.value))}
          >
            <option value="fit">{t("toolbar.fit")}</option>
            {ZOOMS.map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
        </>
      }
      notice={notice}
      first={
        <EditorPane
          title="Mermaid"
          htmlFor="mermaid-input"
          scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => edit("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea
            id="mermaid-input"
            wrap="off"
            placeholder="flowchart LR\n  A --> B"
            value={input}
            onChange={(event) => edit(event.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane
          title={t("pane.diagram")}
          scroll={false}
          actions={
            diagram ? (
              <>
                <CopyButton value={diagram.svg} label={t("action.copySvg")} />
                <button type="button" className="toolbar-text-button" onClick={() => save("svg")}>
                  {t("action.saveSvg")}
                </button>
                <button type="button" className="toolbar-text-button" onClick={() => save("png")}>
                  {t("action.savePng")}
                </button>
              </>
            ) : undefined
          }
        >
          {diagram ? (
            <div className="mermaid-stage" style={{ background: BACKGROUNDS[theme] }} data-fit={zoom === null || undefined}>
              <img
                src={svgDataUrl(diagram.svg)}
                alt={t("diagram.alt", { type: diagram.type })}
                width={zoom === null ? diagram.width : Math.round((diagram.width * zoom) / 100)}
                height={zoom === null ? diagram.height : Math.round((diagram.height * zoom) / 100)}
                style={{ opacity: error ? 0.4 : undefined }}
              />
            </div>
          ) : (
            <PaneEmpty title={t("empty.title")} hint={t("empty.hint")} />
          )}
        </EditorPane>
      }
      status={
        diagram ? (
          <>
            <span>{diagram.type}</span>
            <span>
              {diagram.width} × {diagram.height}
            </span>
            <span>{zoom === null ? t("status.fit") : `${zoom}%`}</span>
          </>
        ) : undefined
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }))} />}
    />
  );
}
