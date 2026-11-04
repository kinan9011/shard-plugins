import { useMemo, useState } from "react";
import { ArrowRightLeft, ListChecks } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "@/components/tools/CopyButton";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { useT, type TKey } from "@/lib/i18n";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  RANGE_EXAMPLES,
  VERSION_DIALECTS,
  compareVersions,
  evaluateRange,
  nextVersions,
  splitVersions,
  type VersionCheck,
  type VersionDialect,
} from "@/utils/semver";

const DEFAULT_VERSIONS = ["1.1.9", "1.2.0", "1.4.2", "1.9.0-beta.1", "2.0.0", "2.0.5", "2.1.0"].join("\n");

const FAQ_KEYS = ["dialects", "caretTilde", "joining", "prerelease", "normalized", "ordering", "rules"] as const;

const STATUS_TEXT: Record<NonNullable<VersionCheck["status"]>, { label: TKey; className: string }> = {
  match: { label: "status.match", className: "text-success" },
  miss: { label: "status.miss", className: "text-muted-foreground" },
  prerelease: { label: "status.prerelease", className: "text-warning" },
  unstable: { label: "status.unstable", className: "text-warning" },
};

const ORDER_TEXT = { [-1]: "<", 0: "=", 1: ">" } as const;

const isExample = (range: string) => Object.values(RANGE_EXAMPLES).some((examples) => examples.some((example) => example.range === range));

export function SemverCalculator() {
  const t = useT();
  const [dialect, setDialect] = useState<VersionDialect>("npm");
  const [range, setRange] = useState(RANGE_EXAMPLES.npm[0].range);
  const [versions, setVersions] = useState(DEFAULT_VERSIONS);
  const [left, setLeft] = useState("2.0.0-beta.11");
  const [right, setRight] = useState("2.0.0-rc.1");
  const [preid, setPreid] = useState("rc");

  const rangeText = useDebouncedValue(range);
  const versionsText = useDebouncedValue(versions);
  const leftText = useDebouncedValue(left);
  const rightText = useDebouncedValue(right);

  const result = useMemo(() => evaluateRange(dialect, rangeText, splitVersions(versionsText)), [dialect, rangeText, versionsText, t]);
  const comparison = useMemo(() => compareVersions(dialect, leftText, rightText), [dialect, leftText, rightText, t]);
  const next = useMemo(() => nextVersions(dialect, leftText, preid), [dialect, leftText, preid, t]);
  const dialectLabel = VERSION_DIALECTS.find((item) => item.id === dialect)?.label ?? dialect;

  const changeDialect = (value: string) => {
    const nextDialect = value as VersionDialect;
    setDialect(nextDialect);
    // Swap an untouched example for one in the new syntax. Keep a typed range, so the user can see how it reads.
    if (isExample(range)) setRange(RANGE_EXAMPLES[nextDialect][0].range);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            {t("range.title")}
          </CardTitle>
          <CardDescription>{t("range.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={dialect} onValueChange={changeDialect}>
            <TabsList aria-label={t("range.packageManager")}>
              {VERSION_DIALECTS.map((item) => (
                <TabsTrigger key={item.id} value={item.id}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="space-y-2">
            <Label htmlFor="semver-range">{t("range.label")}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="semver-range"
                type="text"
                aria-label={t("range.label")}
                aria-invalid={!result.ok}
                aria-describedby="semver-explanation"
                spellCheck={false}
                autoComplete="off"
                placeholder={t("range.placeholder")}
                value={range}
                onChange={(event) => setRange(event.target.value)}
                className="min-w-48 flex-1 font-mono" dir="ltr"
              />
              <Select value="" onValueChange={setRange}>
                <SelectTrigger className="h-8 w-40 shrink-0" aria-label={t("range.examples")}>
                  <SelectValue placeholder={t("range.examples")} />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_EXAMPLES[dialect].map((example) => (
                    <SelectItem key={example.range} value={example.range}>
                      {t(example.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div id="semver-explanation" className="space-y-2">
            {result.ok ? (
              <>
                <div className="flex items-center gap-2">
                  <code dir="ltr" className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-sm" aria-label={t("range.normalized")}>
                    {result.explanation.normalized}
                  </code>
                  <CopyButton value={result.explanation.normalized} ariaLabel={t("range.copyNormalized")} iconOnly />
                </div>
                <div className="space-y-1">
                  {result.explanation.sentences.map((sentence, index) => (
                    <p key={`${index}-${sentence}`} className="text-base font-medium">
                      {index > 0 ? (
                        <>
                          <span className="text-muted-foreground">{t("range.or")} </span>
                          {sentence[0].toLowerCase() + sentence.slice(1)}
                        </>
                      ) : (
                        sentence
                      )}
                    </p>
                  ))}
                </div>
                {result.explanation.notes.map((note) => (
                  <p key={note} className="text-xs text-muted-foreground">
                    {note}
                  </p>
                ))}
              </>
            ) : (
              <div className="workspace-notice rounded-md" data-tone="error" role="alert">
                {"error" in result && result.error}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("versions.title")}</CardTitle>
          <CardDescription>{t("versions.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <Textarea
              aria-label={t("versions.title")}
              spellCheck={false}
              autoComplete="off"
              value={versions}
              onChange={(event) => setVersions(event.target.value)}
              className="min-h-48 font-mono" dir="ltr"
              placeholder={"1.2.0\n1.4.2\n2.0.0"}
            />
            <div className="space-y-3">
              {result.checks.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("versions.empty")}</p>
              ) : (
                <table className="w-full text-sm" aria-label={t("versions.results")}>
                  <tbody>
                    {result.checks.map((check, index) => {
                      const status = check.status ? STATUS_TEXT[check.status] : undefined;
                      return (
                        <tr key={`${index}-${check.input}`} className="border-b border-border/50 align-top">
                          <th scope="row" dir="ltr" className="py-1.5 pe-3 text-start font-mono font-normal">
                            {check.input}
                            {check.normalized && check.normalized !== check.input && check.normalized !== `${check.input}.0` && (
                              <span className="block text-xs text-muted-foreground">{check.normalized}</span>
                            )}
                          </th>
                          <td className={`py-1.5 ${check.error ? "text-destructive" : (status?.className ?? "text-muted-foreground")}`}>
                            {check.error ?? (status ? t(status.label) : t("status.fixRange"))}
                            {check.highest && <span className="ms-2 rounded bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success">{t("status.highest")}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {result.ok && result.checks.length > 0 && (
                <p className="text-sm" role="status">
                  {result.highest ? (
                    <>
                      {t("versions.highestMatch")} <code dir="ltr" className="font-mono font-medium">{result.highest}</code>
                    </>
                  ) : (
                    (result.highestNote ?? t("versions.noMatch"))
                  )}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            {t("compare.title")}
          </CardTitle>
          <CardDescription>{t("compare.description", { dialect: dialectLabel })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2" dir="ltr">
            <Input
              type="text"
              aria-label={t("compare.first")}
              aria-invalid={"side" in comparison && comparison.side === "left"}
              spellCheck={false}
              autoComplete="off"
              value={left}
              onChange={(event) => setLeft(event.target.value)}
              className="w-48 font-mono"
            />
            <span className="w-6 text-center font-mono text-lg font-semibold" aria-label={t("compare.order")}>
              {comparison.ok ? ORDER_TEXT[comparison.order] : "?"}
            </span>
            <Input
              type="text"
              aria-label={t("compare.second")}
              aria-invalid={"side" in comparison && comparison.side === "right"}
              spellCheck={false}
              autoComplete="off"
              value={right}
              onChange={(event) => setRight(event.target.value)}
              className="w-48 font-mono"
            />
          </div>
          {comparison.ok ? (
            <div className="space-y-1" role="status">
              <p className="text-base font-medium">
                {comparison.order === 0
                  ? t("compare.same", { left: comparison.left, right: comparison.right })
                  : t(comparison.order < 0 ? "compare.older" : "compare.newer", { left: comparison.left, right: comparison.right })}
              </p>
              {comparison.bump && <p className="text-sm text-muted-foreground">{t("compare.change", { bump: comparison.bump })}</p>}
              {comparison.note && <p className="text-xs text-muted-foreground">{comparison.note}</p>}
            </div>
          ) : (
            <div className="workspace-notice rounded-md" data-tone="error" role="alert">
              {"error" in comparison && comparison.error}
            </div>
          )}

          {next.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">{t("next.title", { version: left.trim() })}</h3>
                {(dialect === "npm" || dialect === "cargo") && (
                  <Input
                    type="text"
                    aria-label={t("next.preid")}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="rc"
                    value={preid}
                    onChange={(event) => setPreid(event.target.value)}
                    className="h-7 w-24 font-mono"
                  />
                )}
              </div>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("next.list")}>
                {next.map((item) => (
                  <li key={item.label} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                    <code dir="ltr" className="ms-auto font-mono text-sm">{item.version}</code>
                    <CopyButton value={item.version} ariaLabel={t("next.copy", { label: item.label.toLowerCase() })} iconOnly />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />
    </div>
  );
}
