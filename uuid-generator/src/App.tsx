import { useState } from "react";
import { CopyButton } from "./CopyButton";
import { autoDir, t as tNow, useT, type TKey } from "./lib/i18n";
import type { ShardSdk } from "./shard-sdk";
import { UUID_NAMESPACES, generateMultipleUUIDs, inspectIdentifier, isValidUUID, type UUIDVersion } from "./uuid";

const VERSION_OPTIONS: Array<{ value: UUIDVersion; labelKey: TKey }> = [
  { value: "4", labelKey: "version.v4" },
  { value: "1", labelKey: "version.v1" },
  { value: "7", labelKey: "version.v7" },
  { value: "6", labelKey: "version.v6" },
  { value: "3", labelKey: "version.v3" },
  { value: "5", labelKey: "version.v5" },
  { value: "ulid", labelKey: "version.ulid" },
];

const FAQ_KEYS = ["version", "ulid", "strict", "nameBased"] as const;

type NamespaceKey = keyof typeof UUID_NAMESPACES | "custom";

const NAMESPACE_OPTIONS: Array<{ value: NamespaceKey; label: string }> = [
  { value: "DNS", label: "DNS" },
  { value: "URL", label: "URL" },
  { value: "OID", label: "OID" },
  { value: "X500", label: "X.500" },
  { value: "custom", label: "" },
];

function getGenerateButtonLabel(version: UUIDVersion, count: number) {
  if (version === "ulid") return tNow("generate.ulid", { count });
  return tNow("generate.uuid", { count, version });
}

const field = "w-full rounded border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const label = "text-sm font-medium text-foreground";

export default function App({ sdk }: { sdk: ShardSdk }) {
  const t = useT();
  const [version, setVersion] = useState<UUIDVersion>("4");
  const [count, setCount] = useState(5);
  const [output, setOutput] = useState("");
  const [namespaceKey, setNamespaceKey] = useState<NamespaceKey>("DNS");
  const [customNamespace, setCustomNamespace] = useState("");
  const [name, setName] = useState("www.example.com");
  const [inspectInput, setInspectInput] = useState("");
  const [notice, setNotice] = useState("");

  const isNameBased = version === "3" || version === "5";
  const namespace = namespaceKey === "custom" ? customNamespace.trim() : UUID_NAMESPACES[namespaceKey];
  const namespaceInvalid = isNameBased && !isValidUUID(namespace);
  const inspection = inspectInput.trim() ? inspectIdentifier(inspectInput) : null;

  const fail = (message: string) => {
    setNotice(message);
    void sdk.toast(message, "error").catch(() => {});
  };

  const generate = () => {
    setNotice("");
    try {
      if (namespaceInvalid) return fail(t("error.namespace"));
      // Name-based UUIDs are deterministic, so repeating them adds nothing.
      setOutput(generateMultipleUUIDs(isNameBased ? 1 : count, version, { namespace, name }).join("\n"));
    } catch (error) {
      fail(error instanceof Error ? error.message : t("error.generate"));
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="uuid-version" className={label}>{t("field.version")}</label>
          <select id="uuid-version" value={version} onChange={(event) => setVersion(event.target.value as UUIDVersion)} className={`${field} h-7`}>
            {VERSION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
            ))}
          </select>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("note.simplified")}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="uuid-count" className={label}>{t("field.count")}</label>
          <input id="uuid-count" type="number" min="1" max="1000" value={count} onChange={(event) => setCount(parseInt(event.target.value) || 1)} className={`${field} h-7`} />
          <p className="text-xs text-muted-foreground">{t("note.countRange")}</p>
        </div>
      </div>

      {isNameBased && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="uuid-namespace" className={label}>{t("field.namespace")}</label>
            <select id="uuid-namespace" value={namespaceKey} onChange={(event) => setNamespaceKey(event.target.value as NamespaceKey)} className={`${field} h-7`}>
              {NAMESPACE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.value === "custom" ? t("namespace.custom") : option.label}</option>
              ))}
            </select>
            {namespaceKey === "custom" ? (
              <input aria-label={t("field.customNamespace")} dir="ltr" value={customNamespace} onChange={(event) => setCustomNamespace(event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className={`${field} h-7 font-mono`} />
            ) : (
              <p className="font-mono text-xs text-muted-foreground" dir="ltr">{namespace}</p>
            )}
            {namespaceInvalid && <p className="text-xs text-destructive">{t("error.validUuid")}</p>}
          </div>
          <div className="space-y-2">
            <label htmlFor="uuid-name" className={label}>{t("field.name")}</label>
            <input id="uuid-name" dir={autoDir(name)} value={name} onChange={(event) => setName(event.target.value)} className={`${field} h-7`} />
            <p className="text-xs text-muted-foreground">{t("note.deterministic")}</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={generate} className="inline-flex h-7 items-center gap-2 rounded bg-primary-solid px-4 text-sm text-primary-solid-foreground hover:bg-primary-solid/90">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </svg>
          {getGenerateButtonLabel(version, isNameBased ? 1 : count)}
        </button>
        {notice && <span role="alert" className="text-sm text-destructive">{notice}</span>}
      </div>

      {output && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="uuid-output" className={label}>{t("field.output")}</label>
            <CopyButton value={output} label={t("field.output")} writeText={sdk.clipboard.writeText} onError={fail} />
          </div>
          <textarea id="uuid-output" value={output} readOnly dir="ltr" className="h-48 w-full resize-none rounded-md border border-border bg-muted p-3 font-mono text-sm focus:outline-none" />
        </div>
      )}

      <div className="space-y-3 border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-foreground">{t("inspect.title")}</h2>
        <div className="space-y-2">
          <label htmlFor="uuid-inspect" className={label}>{t("inspect.label")}</label>
          <input id="uuid-inspect" value={inspectInput} onChange={(event) => setInspectInput(event.target.value)} dir="ltr" placeholder={t("inspect.placeholder")} className={`${field} h-7 font-mono`} />
        </div>
        {inspection && !inspection.valid && <p className="text-sm text-destructive">{inspection.error}</p>}
        {inspection?.valid && (
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-muted p-3 text-sm">
            <dt className="text-muted-foreground">{t("inspect.type")}</dt>
            <dd>{inspection.kind === "ulid" ? "ULID" : "UUID"}</dd>
            {inspection.kind === "uuid" && (
              <>
                <dt className="text-muted-foreground">{t("field.version")}</dt>
                <dd>{inspection.version}</dd>
                <dt className="text-muted-foreground">{t("inspect.variant")}</dt>
                <dd>{inspection.variant}</dd>
              </>
            )}
            {inspection.date && (
              <>
                <dt className="text-muted-foreground">{t("inspect.timestamp")}</dt>
                <dd className="font-mono" dir="ltr">{inspection.date.toISOString()}</dd>
              </>
            )}
          </dl>
        )}
        <p className="text-xs text-muted-foreground">{t("inspect.note")}</p>
      </div>

      <section aria-label={t("faq.label")} className="space-y-2 border-t border-border pt-4">
        <h2 className="text-sm font-medium text-foreground">{t("toolFaq.title")}</h2>
        {FAQ_KEYS.map((slug) => (
          <details key={slug} className="rounded-md border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">{t(`faq.${slug}.q`)}</summary>
            <p className="mt-1.5 text-muted-foreground">{t(`faq.${slug}.a`)}</p>
          </details>
        ))}
      </section>
    </main>
  );
}
