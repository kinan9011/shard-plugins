import { useMemo, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  decodeAsnInput,
  parseAsn1,
  type AsnNode,
} from "@/utils/asn1-inspector";
import { blobSource } from "@/utils/byte-source";
import {
  CodeTextarea,
  EditorPane,
  PaneEmpty,
  ToolWorkspace,
} from "./ToolWorkspace";
import { CopyButton } from "./CopyButton";
import { useT, type TKey } from "@/lib/i18n";

const CLASS_KEYS: Record<string, TKey> = {
  Universal: "class.universal",
  Application: "class.application",
  "Context-specific": "class.contextSpecific",
  Private: "class.private",
};

function Tree({ nodes }: { nodes: AsnNode[] }) {
  const t = useT();
  return (
    <ul className="ps-4 space-y-2">
      {nodes.map((n) => (
        <li key={n.offset}>
          <details>
            <summary className="cursor-pointer text-sm">
              <span className="font-medium">{n.name}</span>{" "}
              <span className="text-muted-foreground">
                <span dir="ltr">@{n.offset}</span> · {t("unit.bytes", { count: n.length })}
              </span>
              {n.value && (
                <span dir="ltr" className="font-mono break-all"> · {n.value}</span>
              )}
            </summary>
            <div className="border-s ps-3 py-2 space-y-2 text-sm">
              <p>
                {CLASS_KEYS[n.tagClass] ? t(CLASS_KEYS[n.tagClass]) : n.tagClass} · {t("node.tag", { tag: n.tag })} ·{" "}
                {n.constructed ? t("node.constructed") : t("node.primitive")} ·{" "}
                {t("node.header", { size: t("unit.bytes", { count: n.header }) })}
              </p>
              <pre dir="ltr" className="whitespace-pre-wrap break-all font-mono">
                {n.hex || t("node.empty")}
              </pre>
              {n.children.length > 0 && <Tree nodes={n.children} />}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
export function Asn1Inspector() {
  const t = useT();
  const [input, setInput] = useState("");
  const [format, setFormat] = useState<"pem" | "hex" | "base64">("pem");
  const [file, setFile] = useState<{
    name: string;
    bytes: Uint8Array;
  } | null>(null);
  const [fileError, setFileError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const text = useDebouncedValue(input);
  const result = useMemo(() => {
    try {
      return {
        nodes:
          file || text.trim()
            ? parseAsn1(file?.bytes ?? decodeAsnInput(text, format))
            : null,
        error: "",
      };
    } catch (e) {
      return { nodes: null, error: (e as Error).message };
    }
  }, [text, format, file, t]);
  return (
    <ToolWorkspace
      wrapToolbar
      id="asn1-inspector"
      toolbar={
        <>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 pe-7 text-sm text-foreground"
            aria-label={t("format.aria")}
            value={format}
            onChange={(e) => setFormat(e.target.value as typeof format)}
          >
            <option value="pem">PEM</option>
            <option value="hex">Hex</option>
            <option value="base64">Base64</option>
          </select>
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-label={t("file.aria")}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              // Clear the input so choosing the same file again fires a change.
              e.target.value = "";
              if (!f) return;
              const id = ++request.current;
              setFileError("");
              setBusy(true);
              setFile(null);
              try {
                if (f.size > 1000000)
                  throw new Error(t("error.fileLimit"));
                const bytes = await blobSource(f).read(0, f.size);
                if (id === request.current) setFile({ name: f.name, bytes });
              } catch (e) {
                if (id === request.current) setFileError((e as Error).message);
              } finally {
                if (id === request.current) setBusy(false);
              }
            }}
          />
          <button
            type="button"
            className="toolbar-text-button"
            onClick={() => fileInput.current?.click()}
          >
            <FileUp size={14} aria-hidden="true" />
            {t("action.openFile")}
          </button>
          <button
            className="toolbar-text-button"
            onClick={() => {
              request.current++;
              setFile(null);
              setBusy(false);
              setFileError("");
              setFormat("hex");
              setInput("30 08 02 01 2a 0c 03 48 65 79");
            }}
          >
            {t("action.example")}
          </button>
        </>
      }
      notice={
        (result.error || fileError) && (
          <div role="alert" className="workspace-notice" data-tone="error">
            {result.error || fileError}
          </div>
        )
      }
      first={
        <EditorPane
          title={t("pane.input")}
          htmlFor="asn-input"
          actions={
            file && (
              <button
                className="toolbar-text-button"
                onClick={() => setFile(null)}
              >
                {t("action.clearFile")}
              </button>
            )
          }
        >
          {file ? (
            <p className="p-4">
              {file.name} · {t("unit.bytes", { count: file.bytes.length })}
            </p>
          ) : (
            <CodeTextarea
              id="asn-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("input.placeholder")}
            />
          )}
        </EditorPane>
      }
      second={
        <EditorPane
          title={t("pane.structure")}
          actions={
            <CopyButton
              value={result.nodes ? JSON.stringify(result.nodes, null, 2) : ""}
              label={t("copy.json")}
            />
          }
        >
          {busy ? (
            <PaneEmpty title={t("empty.reading")} />
          ) : result.nodes ? (
            <div className="p-3">
              <Tree nodes={result.nodes} />
            </div>
          ) : (
            <PaneEmpty
              title={t("empty.title")}
              hint={t("empty.hint")}
            />
          )}
        </EditorPane>
      }
      status={
        <span>{t("status.limits")}</span>
      }
    />
  );
}
