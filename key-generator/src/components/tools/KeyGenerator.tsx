import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, KeySquare, RefreshCw } from "lucide-react";
import { toast } from "@/shims/sonner";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection, type ToolFaqItem } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { saveFile } from "@/lib/desktop";
import { t as tNow, useT } from "@/lib/i18n";
import {
  KEY_TYPES,
  KeyInputError,
  buildKeyOutputs,
  generateKeyPair,
  jwkAlgorithms,
  jwkUses,
  readKey,
  sshFileStem,
  type JwkUse,
  type KeyOutputs,
  type KeyType,
  type ReadKeyResult,
} from "@/utils/key-generator";

const FAQ_KEYS = ["keyType", "rsaUse", "ssh", "passphrase", "kid", "fingerprint", "convert", "upload"] as const;

const USE_LABEL_KEYS = { sig: "jwk.use.sig", enc: "jwk.use.enc", "": "jwk.notSet" } as const;

type Format = "pem" | "ssh" | "jwk";

interface ReadState {
  key: ReadKeyResult | null;
  error: string;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof KeyInputError ? error.message : error instanceof Error && error.message ? `${fallback} ${error.message}` : fallback;

/** OpenSSH rejects a private key file without a final newline, so every saved file ends with one. */
const withNewline = (text: string) => (text.endsWith("\n") ? text : `${text}\n`);

async function saveText(text: string, fileName: string) {
  try {
    if (await saveFile(new Blob([withNewline(text)], { type: "text/plain" }), fileName)) toast.success(tNow("toast.saved", { name: fileName }));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : tNow("toast.saveFailed"));
  }
}

function KeyBlock({ title, value, fileName, extra }: { title: string; value: string; fileName: string; extra?: ReactNode }) {
  const t = useT();
  return (
    <section className="border-b border-border/50" aria-label={title}>
      <div className="flex items-center justify-between gap-2 px-4 pt-2">
        <span className="result-row-label">{title}</span>
        <div className="pane-actions">
          {extra}
          <CopyButton value={value} iconOnly label={t("block.copy", { title })} />
          <button type="button" className="toolbar-text-button" aria-label={t("block.save", { title })} onClick={() => void saveText(value, fileName)}>
            <Download size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <pre dir="ltr" className="overflow-x-auto px-4 pb-3 pt-1 font-mono text-xs leading-[18px]"><code>{value.trimEnd()}</code></pre>
    </section>
  );
}

function PublicOnlyNote() {
  const t = useT();
  return <p className="border-b border-border/50 px-4 py-2 text-xs text-muted-foreground">{t("note.publicOnly")}</p>;
}

export function KeyGenerator() {
  const t = useT();
  const [keyType, setKeyType] = useState<KeyType>("ed25519");
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [kid, setKid] = useState("");
  const [use, setUse] = useState<JwkUse>("sig");
  // "auto" picks the usual algorithm for the key, so a new key type never keeps an alg that does not fit.
  const [alg, setAlg] = useState("auto");
  const [comment, setComment] = useState("");
  const [format, setFormat] = useState<Format>("pem");
  const [read, setRead] = useState<ReadState>({ key: null, error: "" });
  const [outputs, setOutputs] = useState<KeyOutputs | null>(null);
  const [outputError, setOutputError] = useState("");
  const generation = useRef(0);

  const pendingInput = useDebouncedValue(input);
  const pendingKid = useDebouncedValue(kid);
  const pendingComment = useDebouncedValue(comment);

  const generate = useCallback(async (type: KeyType) => {
    const id = ++generation.current;
    setGenerating(true);
    setGenerateError("");
    try {
      const jwk = await generateKeyPair(type);
      const { privatePem } = await buildKeyOutputs(jwk);
      if (id === generation.current) setInput(privatePem!);
    } catch (error) {
      if (id === generation.current) setGenerateError(errorMessage(error, tNow("error.generate")));
    } finally {
      if (id === generation.current) setGenerating(false);
    }
  }, []);

  useEffect(() => {
    void generate("ed25519");
  }, [generate]);

  /** A user edit wins over a key that is still being generated. */
  const editInput = (value: string) => {
    generation.current++;
    setGenerating(false);
    setGenerateError("");
    setInput(value);
  };

  useEffect(() => {
    if (!pendingInput.trim()) {
      setRead({ key: null, error: "" });
      return;
    }
    let cancelled = false;
    readKey(pendingInput).then(
      (key) => !cancelled && setRead({ key, error: "" }),
      (error: unknown) => !cancelled && setRead({ key: null, error: errorMessage(error, t("error.read")) }),
    );
    return () => {
      cancelled = true;
    };
  }, [pendingInput, t]);

  const jwk = read.key?.jwk;
  const uses = jwk ? jwkUses(jwk) : (["sig", "enc", ""] as JwkUse[]);
  const effectiveUse = uses.includes(use) ? use : "sig";
  const algorithms = jwk ? jwkAlgorithms(jwk, effectiveUse) : [];
  const effectiveAlg = alg === "" ? "" : algorithms.includes(alg) ? alg : (algorithms[0] ?? "");

  useEffect(() => {
    const key = read.key;
    if (!key) {
      setOutputs(null);
      setOutputError("");
      return;
    }
    let cancelled = false;
    buildKeyOutputs(key.jwk, {
      kid: pendingKid.trim() || key.hints.kid,
      use: effectiveUse,
      alg: effectiveAlg,
      comment: pendingComment.trim() || key.comment,
    }).then(
      (result) => {
        if (cancelled) return;
        setOutputs(result);
        setOutputError("");
      },
      (error: unknown) => {
        if (cancelled) return;
        setOutputs(null);
        setOutputError(errorMessage(error, t("error.convert")));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [read, pendingKid, pendingComment, effectiveUse, effectiveAlg, t]);

  const error = generateError || (input.trim() ? read.error || outputError : "");
  const shown = input.trim() && !error ? outputs : null;
  const stem = jwk ? sshFileStem(jwk) : "id_key";

  const notice = error ? (
    <div className="workspace-notice" data-tone="error" role="alert">{error}</div>
  ) : (
    <div className="workspace-notice" role="status">{t("notice.local")}</div>
  );

  return (
    <ToolWorkspace
      id="key-generator"
      toolbar={
        <>
          <label className="indent-control">
            {t("toolbar.keyType")}
            <select
              aria-label={t("toolbar.keyType")}
              value={keyType}
              onChange={(e) => {
                const next = e.target.value as KeyType;
                setKeyType(next);
                void generate(next);
              }}
            >
              {KEY_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </label>
          <button type="button" className="toolbar-text-button indent-control" onClick={() => void generate(keyType)} disabled={generating}>
            <RefreshCw size={14} aria-hidden="true" />
            {t("toolbar.generate")}
          </button>
        </>
      }
      secondaryToolbar={
        <>
          <label className="indent-control" htmlFor="key-kid">
            kid
            <Input
              id="key-kid"
              className="h-7 w-44 font-mono text-xs"
              value={kid}
              onChange={(e) => setKid(e.target.value)}
              placeholder={read.key?.hints.kid || t("jwk.kidPlaceholder")}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="indent-control">
            use
            <select aria-label="use" value={effectiveUse} onChange={(e) => setUse(e.target.value as JwkUse)}>
              {uses.map((value) => (
                <option key={value || "none"} value={value}>{t(USE_LABEL_KEYS[value])}</option>
              ))}
            </select>
          </label>
          <label className="indent-control">
            alg
            <select aria-label="alg" value={effectiveAlg} onChange={(e) => setAlg(e.target.value)}>
              {algorithms.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
              <option value="">{t("jwk.notSet")}</option>
            </select>
          </label>
          <label className="indent-control" htmlFor="key-comment">
            {t("ssh.commentLabel")}
            <Input
              id="key-comment"
              className="h-7 w-44 text-xs"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={read.key?.comment || t("ssh.commentPlaceholder")}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </>
      }
      notice={notice}
      first={
        <EditorPane
          title={t("pane.key")}
          htmlFor="key-input"
          scroll={false}
          actions={
            input ? (
              <button type="button" className="toolbar-text-button" onClick={() => editInput("")}>
                {t("common.clear")}
              </button>
            ) : undefined
          }
        >
          <CodeTextarea
            id="key-input"
            className="break-all"
            value={input}
            onChange={(e) => editInput(e.target.value)}
            placeholder={t("key.placeholder")}
          />
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.formats")}>
          {shown ? (
            <div>
              <div className="result-list">
                <div className="result-row">
                  <span className="result-row-label">{t("info.type")}</span>
                  <span className="result-row-value">{shown.info.label} · {shown.info.isPrivate ? t("info.privateKey") : t("info.publicKey")}</span>
                  <span aria-hidden="true" />
                </div>
                <div className="result-row">
                  <span className="result-row-label">{t("info.sshFingerprint")}</span>
                  <span className="result-row-value" dir="ltr" data-testid="ssh-fingerprint">{shown.sshFingerprint}</span>
                  <CopyButton value={shown.sshFingerprint} iconOnly label={t("copy.sshFingerprint")} />
                </div>
                <div className="result-row">
                  <span className="result-row-label">{t("info.jwkThumbprint")}</span>
                  <span className="result-row-value" dir="ltr" data-testid="jwk-thumbprint">{shown.thumbprint}</span>
                  <CopyButton value={shown.thumbprint} iconOnly label={t("copy.jwkThumbprint")} />
                </div>
              </div>
              <Tabs value={format} onValueChange={(value) => setFormat(value as Format)}>
                <div className="px-4 pt-3">
                  <TabsList aria-label={t("formats.aria")}>
                    <TabsTrigger value="pem">PEM</TabsTrigger>
                    <TabsTrigger value="ssh">OpenSSH</TabsTrigger>
                    <TabsTrigger value="jwk">JWK</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="pem">
                  {shown.privatePem ? <KeyBlock title={t("block.privatePkcs8")} value={shown.privatePem} fileName="private-key.pem" /> : <PublicOnlyNote />}
                  <KeyBlock title={t("block.publicSpki")} value={shown.publicPem} fileName="public-key.pem" />
                </TabsContent>
                <TabsContent value="ssh">
                  <KeyBlock title={t("block.sshPublic")} value={shown.sshPublic} fileName={`${stem}.pub`} />
                  {shown.sshPrivate ? <KeyBlock title={t("block.sshPrivate")} value={shown.sshPrivate} fileName={stem} /> : <PublicOnlyNote />}
                </TabsContent>
                <TabsContent value="jwk">
                  {shown.privateJwk ? <KeyBlock title={t("block.privateJwk")} value={shown.privateJwk} fileName="private-key.jwk.json" /> : <PublicOnlyNote />}
                  <KeyBlock
                    title={t("block.publicJwk")}
                    value={shown.publicJwk}
                    fileName="public-key.jwk.json"
                    extra={<CopyButton value={shown.jwks} label={t("copy.jwks")} />}
                  />
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <PaneEmpty
              icon={<KeySquare size={20} aria-hidden="true" />}
              title={generating ? t("empty.generating") : t("empty.title")}
              hint={t("empty.hint")}
            />
          )}
        </EditorPane>
      }
      status={
        generating ? (
          <span>{t("status.generating")}</span>
        ) : error ? (
          <span className="text-destructive">{generateError ? t("status.notGenerated") : t("status.invalid")}</span>
        ) : shown ? (
          <>
            <span>{shown.info.label}</span>
            <span>{shown.info.isPrivate ? t("status.private") : t("status.publicOnly")}</span>
          </>
        ) : (
          <span>{t("status.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }))} />}
    />
  );
}
