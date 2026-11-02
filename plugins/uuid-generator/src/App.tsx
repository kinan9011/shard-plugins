import { useState } from "react";
import { CopyButton } from "./CopyButton";
import type { DevToolsSdk } from "./devtools-sdk";
import { UUID_NAMESPACES, generateMultipleUUIDs, inspectIdentifier, isValidUUID, type UUIDVersion } from "./uuid";

const VERSION_OPTIONS: Array<{ value: UUIDVersion; label: string }> = [
  { value: "4", label: "UUID v4 (Random)" },
  { value: "1", label: "UUID v1 (Time-based, simplified)" },
  { value: "7", label: "UUID v7 (Time-ordered, simplified)" },
  { value: "6", label: "UUID v6 (Time-ordered, simplified)" },
  { value: "3", label: "UUID v3 (Name-based, MD5)" },
  { value: "5", label: "UUID v5 (Name-based, SHA-1)" },
  { value: "ulid", label: "ULID (Sortable)" },
];

const FAQ_ITEMS = [
  {
    q: "Which version should I pick most of the time?",
    a: "Use UUID v4 when you just need a random identifier and do not care about ordering. Use ULID or the time-ordered versions when you want values that sort more naturally by creation time.",
  },
  {
    q: "What is the difference between UUID and ULID?",
    a: "UUIDs are 36-character identifiers with hyphens, while ULIDs are 26-character Crockford Base32 strings. ULIDs are easier to sort lexicographically by time and are often more compact in logs or URLs.",
  },
  {
    q: "Are all UUID versions here strict RFC implementations?",
    a: "UUID v3, v5, v4, and ULID follow their specifications. The v1, v6, and v7 options are lightweight local approximations. They are useful for demos and tooling, but not ideal when you need full standards-level interoperability.",
  },
  {
    q: "Why are v3 and v5 called name-based?",
    a: "Name-based UUIDs are derived from a namespace plus a name, so the same inputs always produce the same identifier. v3 uses MD5 and v5 uses SHA-1, as in RFC 4122. Prefer v5 for new work.",
  },
];

type NamespaceKey = keyof typeof UUID_NAMESPACES | "custom";

const NAMESPACE_OPTIONS: Array<{ value: NamespaceKey; label: string }> = [
  { value: "DNS", label: "DNS" },
  { value: "URL", label: "URL" },
  { value: "OID", label: "OID" },
  { value: "X500", label: "X.500" },
  { value: "custom", label: "Custom UUID" },
];

function getGenerateButtonLabel(version: UUIDVersion, count: number) {
  if (version === "ulid") return count === 1 ? "Generate 1 ULID" : `Generate ${count} ULIDs`;
  return count === 1 ? `Generate 1 UUID v${version}` : `Generate ${count} UUID v${version}s`;
}

const field = "w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const label = "text-sm font-medium text-foreground";

export default function App({ sdk }: { sdk: DevToolsSdk }) {
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
      if (namespaceInvalid) return fail("Namespace must be a valid UUID");
      // Name-based UUIDs are deterministic, so repeating them adds nothing.
      setOutput(generateMultipleUUIDs(isNameBased ? 1 : count, version, { namespace, name }).join("\n"));
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to generate identifiers");
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="uuid-version" className={label}>Version</label>
          <select id="uuid-version" value={version} onChange={(event) => setVersion(event.target.value as UUIDVersion)} className={`${field} h-10`}>
            {VERSION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <p className="text-xs leading-relaxed text-muted-foreground">
            v1, v6, and v7 are lightweight local implementations in this tool. Prefer v4 or ULID when you want the clearest expectations.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="uuid-count" className={label}>Count</label>
          <input id="uuid-count" type="number" min="1" max="1000" value={count} onChange={(event) => setCount(parseInt(event.target.value) || 1)} className={`${field} h-10`} />
          <p className="text-xs text-muted-foreground">Generate between 1 and 1000 identifiers at a time.</p>
        </div>
      </div>

      {isNameBased && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="uuid-namespace" className={label}>Namespace</label>
            <select id="uuid-namespace" value={namespaceKey} onChange={(event) => setNamespaceKey(event.target.value as NamespaceKey)} className={`${field} h-10`}>
              {NAMESPACE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {namespaceKey === "custom" ? (
              <input aria-label="Custom namespace UUID" value={customNamespace} onChange={(event) => setCustomNamespace(event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className={`${field} h-10 font-mono`} />
            ) : (
              <p className="font-mono text-xs text-muted-foreground">{namespace}</p>
            )}
            {namespaceInvalid && <p className="text-xs text-destructive">Enter a valid UUID.</p>}
          </div>
          <div className="space-y-2">
            <label htmlFor="uuid-name" className={label}>Name</label>
            <input id="uuid-name" value={name} onChange={(event) => setName(event.target.value)} className={`${field} h-10`} />
            <p className="text-xs text-muted-foreground">The same namespace and name always give the same UUID.</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={generate} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm text-primary-foreground hover:opacity-90">
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
            <label htmlFor="uuid-output" className={label}>Output</label>
            <CopyButton value={output} label="Output" writeText={sdk.clipboard.writeText} onError={fail} />
          </div>
          <textarea id="uuid-output" value={output} readOnly className="h-48 w-full resize-none rounded-md border border-border bg-muted p-3 font-mono text-sm focus:outline-none" />
        </div>
      )}

      <div className="space-y-3 border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-foreground">Inspect</h2>
        <div className="space-y-2">
          <label htmlFor="uuid-inspect" className={label}>UUID or ULID</label>
          <input id="uuid-inspect" value={inspectInput} onChange={(event) => setInspectInput(event.target.value)} placeholder="Paste a UUID or ULID" className={`${field} h-10 font-mono`} />
        </div>
        {inspection && !inspection.valid && <p className="text-sm text-destructive">{inspection.error}</p>}
        {inspection?.valid && (
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-muted p-3 text-sm">
            <dt className="text-muted-foreground">Type</dt>
            <dd>{inspection.kind === "ulid" ? "ULID" : "UUID"}</dd>
            {inspection.kind === "uuid" && (
              <>
                <dt className="text-muted-foreground">Version</dt>
                <dd>{inspection.version}</dd>
                <dt className="text-muted-foreground">Variant</dt>
                <dd>{inspection.variant}</dd>
              </>
            )}
            {inspection.date && (
              <>
                <dt className="text-muted-foreground">Timestamp</dt>
                <dd className="font-mono">{inspection.date.toISOString()}</dd>
              </>
            )}
          </dl>
        )}
        <p className="text-xs text-muted-foreground">Timestamps follow the standard layouts. IDs made by the v1 and v6 options here may show other dates.</p>
      </div>

      <section aria-label="Frequently asked questions" className="space-y-2 border-t border-border pt-4">
        <h2 className="text-sm font-medium text-foreground">FAQ</h2>
        {FAQ_ITEMS.map((item) => (
          <details key={item.q} className="rounded-md border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">{item.q}</summary>
            <p className="mt-1.5 text-muted-foreground">{item.a}</p>
          </details>
        ))}
      </section>
    </main>
  );
}
