import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FileBadge, FileUp } from "lucide-react";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { formatDate, t as tNow, useT, type TKey } from "@/lib/i18n";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import {
  certificateFileToText,
  certificateSummaryJson,
  decodeCertificates,
  validityStatus,
  type CertificateParseResult,
  type ChainResult,
  type ParsedCertificate,
  type ParsedCsr,
  type ValidityState,
} from "@/utils/certificate";

const FAQ_KEYS = ["paste", "chain", "fetch", "fingerprint"] as const;

const PLACEHOLDER = "-----BEGIN CERTIFICATE-----\nMIIDdzCCAl+gAwIBAgIE...\n-----END CERTIFICATE-----";

const VALIDITY_TONE: Record<ValidityState, string> = {
  valid: "text-success",
  expiring: "text-warning",
  expired: "text-destructive",
  "not-yet-valid": "text-warning",
};

const MAX_FILE_BYTES = 1024 * 1024;

const readFileBytes = (file: Blob) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error(tNow("error.readFile")));
    reader.readAsArrayBuffer(file);
  });

const formatTimestamp = (date: Date) => `${formatDate(date, { dateStyle: "short", timeStyle: "medium" })} (${date.toISOString()})`;

interface Decoded {
  result: CertificateParseResult | null;
  error: string;
}

const EMPTY: Decoded = { result: null, error: "" };

const Row = ({ label, value, copy, tone }: { label: string; value: ReactNode; copy?: string; tone?: string }) => {
  const t = useT();
  return (
    <div className="result-row">
      <span className="result-row-label">{label}</span>
      <span dir="auto" className={`result-row-value whitespace-pre-line ${tone ?? ""}`}>{value}</span>
      {copy ? <CopyButton value={copy} iconOnly label={t("copy.label", { label })} /> : <span aria-hidden="true" />}
    </div>
  );
};

const lines = (items: string[]) => items.join("\n");

const certificateRole = (cert: ParsedCertificate, index: number, total: number, chain: ChainResult | null, t: (key: TKey, vars?: Record<string, string | number>) => string) => {
  if (!chain?.ordered) return total > 1 ? t("role.certificateN", { n: index + 1 }) : t("role.certificate");
  if (index === 0) return t("role.leaf");
  if (index === total - 1 && cert.selfSigned) return t("role.root");
  return t("role.intermediate");
};

function CertificateSection({ cert, title }: { cert: ParsedCertificate; title: string }) {
  const t = useT();
  const validity = validityStatus(cert.notBefore, cert.notAfter);
  const basic = cert.basicConstraints;
  const sans = cert.subjectAltNames.map((san) => `${san.type}: ${san.value}`);
  return (
    <section className="border-b border-border" aria-label={t("label.titleSubject", { title, subject: cert.subjectText })}>
      <h3 className="px-4 pb-1 pt-3 text-xs font-semibold text-foreground">
        {title}
        {cert.selfSigned && <span className="ms-2 font-normal text-muted-foreground">{t("cert.selfSigned")}</span>}
        <span className="ms-2 font-normal text-muted-foreground">{t("cert.inputBlock", { n: cert.inputIndex })}</span>
      </h3>
      <div className="result-list">
        <Row label={t("row.subject")} value={lines(cert.subject)} copy={cert.subjectText} />
        <Row label={t("row.issuer")} value={lines(cert.issuer)} copy={cert.issuerText} />
        <Row label={t("row.status")} value={validity.label} tone={VALIDITY_TONE[validity.state]} />
        <Row label={t("row.validFrom")} value={formatTimestamp(cert.notBefore)} />
        <Row label={t("row.validTo")} value={formatTimestamp(cert.notAfter)} />
        <Row label={t("row.serial")} value={cert.serialNumber} copy={cert.serialNumber} />
        {sans.length > 0 && <Row label={t("row.altNames")} value={lines(sans)} copy={lines(cert.subjectAltNames.map((s) => s.value))} />}
        <Row label={t("row.publicKey")} value={cert.publicKey} />
        <Row label={t("row.signature")} value={cert.signatureAlgorithm} />
        {cert.keyUsage.length > 0 && <Row label={t("row.keyUsage")} value={lines(cert.keyUsage)} />}
        {cert.extendedKeyUsage.length > 0 && <Row label={t("row.extendedKeyUsage")} value={lines(cert.extendedKeyUsage)} />}
        <Row
          label={t("row.basicConstraints")}
          value={
            basic
              ? [t("basic.ca", { value: basic.ca ? "true" : "false" }), ...(basic.pathLength !== undefined ? [t("basic.pathLength", { length: basic.pathLength })] : []), ...(basic.critical ? [t("basic.critical")] : [])].join(" · ")
              : t("basic.none")
          }
        />
        <Row label="SHA-256" value={cert.sha256} copy={cert.sha256} />
        <Row label="SHA-1" value={cert.sha1} copy={cert.sha1} />
        {cert.subjectKeyId && <Row label={t("row.subjectKeyId")} value={cert.subjectKeyId} copy={cert.subjectKeyId} />}
        {cert.authorityKeyId && <Row label={t("row.authorityKeyId")} value={cert.authorityKeyId} copy={cert.authorityKeyId} />}
        {cert.crlDistributionPoints.length > 0 && (
          <Row label={t("row.crl")} value={lines(cert.crlDistributionPoints)} copy={lines(cert.crlDistributionPoints)} />
        )}
        {cert.ocspUrls.length > 0 && <Row label="OCSP" value={lines(cert.ocspUrls)} copy={lines(cert.ocspUrls)} />}
        {cert.caIssuerUrls.length > 0 && <Row label={t("row.caIssuers")} value={lines(cert.caIssuerUrls)} copy={lines(cert.caIssuerUrls)} />}
      </div>
    </section>
  );
}

function CsrSection({ csr }: { csr: ParsedCsr }) {
  const t = useT();
  const sans = csr.subjectAltNames.map((san) => `${san.type}: ${san.value}`);
  const signature =
    csr.signatureValid === null ? t("csr.notChecked") : csr.signatureValid ? t("csr.signedByOwn") : t("csr.signatureFails");
  return (
    <section className="border-b border-border" aria-label={t("label.titleSubject", { title: t("role.request"), subject: csr.subjectText })}>
      <h3 className="px-4 pb-1 pt-3 text-xs font-semibold text-foreground">
        {t("role.request")}
        <span className="ms-2 font-normal text-muted-foreground">{t("cert.inputBlock", { n: csr.inputIndex })}</span>
      </h3>
      <div className="result-list">
        <Row label={t("row.subject")} value={lines(csr.subject)} copy={csr.subjectText} />
        {sans.length > 0 && <Row label={t("row.altNames")} value={lines(sans)} copy={lines(csr.subjectAltNames.map((s) => s.value))} />}
        <Row label={t("row.publicKey")} value={csr.publicKey} />
        <Row label={t("row.signature")} value={csr.signatureAlgorithm} />
        <Row
          label={t("row.selfSignature")}
          value={signature}
          tone={csr.signatureValid === null ? "text-warning" : csr.signatureValid ? "text-success" : "text-destructive"}
        />
        {csr.keyUsage.length > 0 && <Row label={t("row.keyUsage")} value={lines(csr.keyUsage)} />}
        {csr.extendedKeyUsage.length > 0 && <Row label={t("row.extendedKeyUsage")} value={lines(csr.extendedKeyUsage)} />}
        <Row label="SHA-256" value={csr.sha256} copy={csr.sha256} />
      </div>
    </section>
  );
}

function ChainSection({ chain, certs }: { chain: ChainResult; certs: ParsedCertificate[] }) {
  const t = useT();
  return (
    <section className="border-b border-border" aria-label={t("section.chain")}>
      <h3 className="px-4 pb-1 pt-3 text-xs font-semibold text-foreground">{t("section.chain")}</h3>
      <div className="result-list">
        <Row label={t("row.result")} value={chain.message} tone={chain.ok ? "text-success" : "text-destructive"} />
        {chain.links.map((link) => {
          const signature = link.signatureValid === null ? t("link.sigNotChecked") : link.signatureValid ? t("link.sigOk") : t("link.sigFails");
          const ok = link.issuerMatches && link.signatureValid === true;
          return (
            <Row
              key={link.from}
              label={t("row.link", { from: link.from + 1, to: link.to + 1 })}
              value={`${certs[link.from].subjectText}\n${t("link.signedBy", { issuer: certs[link.to].subjectText })}\n${t(link.issuerMatches ? "link.issuerMatches" : "link.issuerMismatch")} · ${signature}`}
              tone={ok ? undefined : "text-destructive"}
            />
          );
        })}
        <p className="px-4 py-2 text-xs text-muted-foreground">{t("note.offline")}</p>
      </div>
    </section>
  );
}

export function CertificateDecoder() {
  const t = useT();
  const [input, setInput] = useState("");
  const [decoded, setDecoded] = useState<Decoded>(EMPTY);
  const [fileError, setFileError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pending = useDebouncedValue(input);

  useEffect(() => {
    if (!pending.trim()) {
      setDecoded(EMPTY);
      return;
    }
    let cancelled = false;
    decodeCertificates(pending)
      .then((result) => {
        if (!cancelled) setDecoded({ result, error: "" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setDecoded({ result: null, error: error instanceof Error ? error.message : t("error.decode") });
      });
    return () => {
      cancelled = true;
    };
  }, [pending, t]); // t changes with the language, so notes, errors and chain messages are rebuilt in it

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError("");
    if (file.size > MAX_FILE_BYTES) {
      setFileError(t("error.fileTooLarge"));
      return;
    }
    try {
      setInput(await certificateFileToText(await readFileBytes(file)));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : t("error.readFile"));
    }
  };

  const current = input.trim() ? decoded : EMPTY;
  const result = current.result;
  const certs = result?.certificates ?? [];
  const requests = result?.requests ?? [];
  const summary = useMemo(() => (result ? certificateSummaryJson(result) : ""), [result]);
  const error = fileError || current.error;

  const status = () => {
    if (current.error) return <span className="text-destructive">{t("status.invalid")}</span>;
    if (!result) return <span>{t("status.ready")}</span>;
    const leaf = certs[0];
    const validity = leaf ? validityStatus(leaf.notBefore, leaf.notAfter) : null;
    const parts: string[] = [];
    if (certs.length) parts.push(t("status.certificates", { count: certs.length }));
    if (requests.length) parts.push(t("status.requests", { count: requests.length }));
    return (
      <>
        <span>{parts.join(" · ")}</span>
        {validity && <span className={VALIDITY_TONE[validity.state]}>{validity.label}</span>}
        {result.chain && <span className={result.chain.ok ? "text-success" : "text-destructive"}>{result.chain.message}</span>}
      </>
    );
  };

  return (
    <ToolWorkspace
      id="certificate-decoder"
      toolbar={
        <>
          <input
            ref={fileInputRef}
            id="certificate-file"
            type="file"
            accept=".pem,.crt,.cer,.der,.csr,.req"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void openFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button type="button" className="toolbar-text-button" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={14} aria-hidden="true" />
            {t("toolbar.openFile")}
          </button>
          <CopyButton value={summary} label={t("toolbar.copyJson")} />
        </>
      }
      notice={
        error ? (
          <div className="workspace-notice" data-tone="error" role="alert">{error}</div>
        ) : result?.notes.length ? (
          <div className="workspace-notice">{result.notes.join(" ")}</div>
        ) : undefined
      }
      first={
        <EditorPane
          title={t("pane.input")}
          htmlFor="certificate-input"
          scroll={false}
          actions={
            input ? (
              <button type="button" className="toolbar-text-button" onClick={() => { setInput(""); setFileError(""); }}>
                {t("common.clear")}
              </button>
            ) : undefined
          }
        >
          <CodeTextarea
            id="certificate-input"
            className="break-all"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setFileError("");
            }}
            placeholder={PLACEHOLDER}
          />
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.decoded")}>
          {result && (certs.length > 0 || requests.length > 0) ? (
            <div>
              {result.chain && <ChainSection chain={result.chain} certs={certs} />}
              {certs.map((cert, index) => (
                <CertificateSection
                  key={`${cert.inputIndex}-${cert.sha256}`}
                  cert={cert}
                  title={certificateRole(cert, index, certs.length, result.chain, t)}
                />
              ))}
              {requests.map((csr) => (
                <CsrSection key={`${csr.inputIndex}-${csr.sha256}`} csr={csr} />
              ))}
              {!result.chain && <p className="px-4 py-2 text-xs text-muted-foreground">{t("note.offline")}</p>}
            </div>
          ) : (
            <PaneEmpty
              icon={<FileBadge size={20} aria-hidden="true" />}
              title={t("empty.title")}
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
