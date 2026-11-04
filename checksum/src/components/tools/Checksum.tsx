import { useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { FileUp } from "lucide-react";
import { formatNumber, useT } from "@/lib/i18n";
import {
  CRC_PRESETS,
  crc,
  decodeHex,
  luhnCheckDigit,
  luhnValid,
  type CrcPreset,
} from "@/utils/checksum";
import { blobSource } from "@/utils/byte-source";
import { CopyButton } from "./CopyButton";
import {
  CodeTextarea,
  EditorPane,
  PaneEmpty,
  ToolWorkspace,
} from "./ToolWorkspace";
export function Checksum() {
  const t = useT();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("crc");
  const [format, setFormat] = useState("text");
  const [preset, setPreset] = useState<CrcPreset>("CRC-32/ISO-HDLC");
  const [file, setFile] = useState<{
    name: string;
    bytes: Uint8Array;
  } | null>(null);
  const [fileError, setFileError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const text = useDebouncedValue(input);
  // Decode the bytes apart from the CRC, so a preset change does not encode the text again.
  const bytes = useMemo(() => {
    if (mode !== "crc") return null;
    if (file) return file.bytes;
    try {
      if (text.length > 1000000)
        throw new Error(t("error.textLimit"));
      return format === "hex" ? decodeHex(text) : new TextEncoder().encode(text);
    } catch (e) {
      return e as Error;
    }
  }, [mode, file, text, format, t]);
  const { output, error } = useMemo(() => {
    let output = "",
      error = "";
    try {
      if (bytes instanceof Error) throw bytes;
      if (bytes) output = crc(bytes, preset);
      else if (text)
        output =
          mode === "validate"
            ? luhnValid(text)
              ? t("result.luhnValid")
              : t("result.luhnInvalid")
            : `${text}${luhnCheckDigit(text)}`;
    } catch (e) {
      error = (e as Error).message;
    }
    return { output, error };
  }, [bytes, text, mode, preset, t]);
  const p = CRC_PRESETS[preset];
  return (
    <ToolWorkspace
      wrapToolbar
      id="checksum"
      toolbar={
        <>
          <label>
            {t("op.label")}{" "}
            <select
              className="h-8 rounded-md border border-input bg-background px-2 pe-7 text-sm text-foreground"
              aria-label={t("op.aria")}
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setFileError("");
              }}
            >
              <option value="crc">CRC</option>
              <option value="validate">{t("op.validate")}</option>
              <option value="generate">{t("op.generate")}</option>
            </select>
          </label>
          {mode === "crc" && (
            <>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 pe-7 text-sm text-foreground"
                aria-label={t("preset.aria")}
                value={preset}
                onChange={(e) => setPreset(e.target.value as CrcPreset)}
              >
                {Object.keys(CRC_PRESETS).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 pe-7 text-sm text-foreground"
                aria-label={t("format.aria")}
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="text">{t("format.text")}</option>
                <option value="hex">{t("format.hex")}</option>
              </select>
              <input
                ref={fileInput}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-label={t("file.aria")}
                onChange={async (e) => {
                  const next = e.target.files?.[0];
                  // Clear the input so choosing the same file again fires a change.
                  e.target.value = "";
                  if (!next) return;
                  const id = ++request.current;
                  setBusy(true);
                  setFileError("");
                  setFile(null);
                  try {
                    if (next.size > 8 * 1024 * 1024)
                      throw new Error(t("error.fileLimit"));
                    const bytes = await blobSource(next).read(0, next.size);
                    if (id === request.current)
                      setFile({ name: next.name, bytes });
                  } catch (e) {
                    if (id === request.current)
                      setFileError((e as Error).message);
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
                {t("file.open")}
              </button>
            </>
          )}
        </>
      }
      notice={
        (error || fileError) && (
          <div className="workspace-notice" data-tone="error" role="alert">
            {error || fileError}
          </div>
        )
      }
      first={
        <EditorPane
          title={t("pane.input")}
          htmlFor="checksum-input"
          actions={
            file && (
              <button
                className="toolbar-text-button"
                onClick={() => {
                  request.current++;
                  setFile(null);
                  setFileError("");
                  setBusy(false);
                }}
              >
                {t("file.clear")}
              </button>
            )
          }
        >
          {mode === "crc" && file ? (
            <p className="p-4">
              {t("file.info", { count: file.bytes.length, name: file.name, size: formatNumber(file.bytes.length) })}
            </p>
          ) : (
            <CodeTextarea
              id="checksum-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                mode === "crc"
                  ? t("placeholder.crc")
                  : t("placeholder.luhn")
              }
            />
          )}
        </EditorPane>
      }
      second={
        <EditorPane
          title={t("pane.result")}
          actions={
            <CopyButton value={busy || error || fileError ? "" : output} />
          }
        >
          {busy ? (
            <PaneEmpty title={t("state.reading")} />
          ) : error || fileError ? (
            <PaneEmpty title={t("state.checkInput")} />
          ) : (
            <pre dir={mode === "validate" ? undefined : "ltr"} className="p-4 whitespace-pre-wrap break-all font-mono">
              {output}
            </pre>
          )}
        </EditorPane>
      }
      help={
        <details className="p-3 text-sm">
          <summary className="cursor-pointer">{t("help.summary")}</summary>
          <p className="pt-2 break-all">
            {t("help.params", {
              polynomial: `0x${p.polynomial.toString(16)}`,
              init: `0x${p.init.toString(16)}`,
              xor: `0x${p.xor.toString(16)}`,
              reflected: t(p.reflected ? "help.yes" : "help.no"),
            })}
          </p>
        </details>
      }
      status={
        <span>
          {mode === "crc"
            ? t("status.crc", { preset, width: p.width })
            : t("status.luhn")}
        </span>
      }
    />
  );
}
