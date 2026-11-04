import { Code, Eye } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { autoDir, useT } from "./lib/i18n";
import { ClipboardProvider, CopyButton } from "./CopyButton";
import type { ShardSdk } from "./shard-sdk";
import { convertMarkdown, sanitizeHtml } from "./markdown";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Textarea } from "./ui";

const defaultMarkdown = `# Welcome to Markdown Editor

## Features

- **Bold** and *italic* text
- Lists (ordered and unordered)
- [Links](https://example.com)
- \`Inline code\` and code blocks

## Code Block

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Table

| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |

## Blockquote

> This is a blockquote
> with multiple lines

---

**Start typing to see the preview!**
`;

export default function App({ sdk }: { sdk: ShardSdk }) {
  const t = useT();
  // A refused copy (no clipboard:write) is told to the user in the app; it is never a crash.
  const clipboard = useMemo(() => ({ writeText: (text: string) => sdk.clipboard.writeText(text), onError: (message: string) => void sdk.toast(message, "error").catch(() => {}) }), [sdk]);
  const [markdown, setMarkdown] = useState(defaultMarkdown);
  const [view, setView] = useState<"split" | "preview" | "source">("split");
  const deferredMarkdown = useDeferredValue(markdown);
  const html = useMemo(() => sanitizeHtml(convertMarkdown(deferredMarkdown)), [deferredMarkdown]);
  return (
    <ClipboardProvider value={clipboard}>
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("app.title")}</CardTitle>
          <CardDescription>{t("app.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <Button
              variant={view === "split" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("split")}
            >
              <Code className="h-4 w-4 me-1" />
              {t("view.split")}
            </Button>
            <Button
              variant={view === "preview" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("preview")}
            >
              <Eye className="h-4 w-4 me-1" />
              {t("view.preview")}
            </Button>
            <Button
              variant={view === "source" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("source")}
            >
              <Code className="h-4 w-4 me-1" />
              {t("view.source")}
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {(view === "split" || view === "source") && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">{t("pane.markdown")}</label>
                  <CopyButton value={markdown} label={t("copy.markdown")} />
                </div>
                <Textarea
                  value={markdown}
                  onChange={(e) => setMarkdown(e.target.value)}
                  className="min-h-[500px] font-mono text-sm resize-none"
                  placeholder={t("editor.placeholder")}
                  dir={autoDir(markdown)}
                />
              </div>
            )}

            {(view === "split" || view === "preview") && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">{t("pane.htmlPreview")}</label>
                  <CopyButton value={html.replace(/<br>/g, "\n")} label={t("copy.html")} />
                </div>
                <div
                  dir="auto"
                  className="min-h-[500px] max-h-[500px] overflow-y-auto rounded-md border border-border bg-background p-4 text-foreground prose prose-neutral max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-code:text-foreground prose-pre:bg-muted prose-blockquote:text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("ref.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <code className="text-xs"># Heading</code>
              <p className="text-muted-foreground text-xs">{t("ref.h1")}</p>
            </div>
            <div>
              <code className="text-xs">**bold**</code>
              <p className="text-muted-foreground text-xs">{t("ref.bold")}</p>
            </div>
            <div>
              <code className="text-xs">*italic*</code>
              <p className="text-muted-foreground text-xs">{t("ref.italic")}</p>
            </div>
            <div>
              <code className="text-xs">[text](url)</code>
              <p className="text-muted-foreground text-xs">{t("ref.link")}</p>
            </div>
            <div>
              <code className="text-xs">\`code\`</code>
              <p className="text-muted-foreground text-xs">{t("ref.code")}</p>
            </div>
            <div>
              <code className="text-xs">- item</code>
              <p className="text-muted-foreground text-xs">{t("ref.list")}</p>
            </div>
            <div>
              <code className="text-xs">&gt; quote</code>
              <p className="text-muted-foreground text-xs">{t("ref.quote")}</p>
            </div>
            <div>
              <code className="text-xs">---hr---</code>
              <p className="text-muted-foreground text-xs">{t("ref.hr")}</p>
            </div>
            <div>
              <code className="text-xs">![alt](data:…)</code>
              <p className="text-muted-foreground text-xs">{t("ref.image")}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
    </ClipboardProvider>
  );
}
