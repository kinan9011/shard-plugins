import { Calendar, Clock, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ClipboardProvider, CopyButton } from "./CopyButton";
import { CronBuilder } from "./CronBuilder";
import type { ShardSdk } from "./shard-sdk";
import { ToolFaqSection, type ToolFaqItem } from "./ToolFaq";
import { LOCALES, useLocale, useT } from "./lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, SELECT_CLASS } from "./ui";
import { useDebouncedValue } from "./useDebouncedValue";
import {
  CRON_EXAMPLES,
  cronDialectLabel,
  cronFieldLabel,
  cronLayout,
  describeCron,
  describeCronField,
  formatCronValues,
  formatTimeUntil,
  isValidTimeZone,
  nextCronRuns,
  parseCron,
  readCronInput,
  replaceCronField,
  type CronFieldName,
} from "./cron";

const RUN_COUNT = 5;
const LOCAL_ZONE = "local";

const FAQ_KEYS = ["format", "paste", "dayOr", "timeZone", "dst", "special"] as const;

/** Text with `code` spans: the odd pieces between backticks are code. Keeps markup out of the dictionaries. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((piece, index) =>
        index % 2 === 1 ? (
          <code key={index} dir="ltr">
            {piece}
          </code>
        ) : (
          piece
        ),
      )}
    </>
  );
}

/** A field editor that keeps a local draft, so a cleared field does not change the expression. */
function FieldInput({ name, value, invalid, onCommit }: { name: CronFieldName; value: string; invalid: boolean; onCommit: (value: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      type="text"
      aria-label={t("cron.fieldAria", { field: cronFieldLabel(name) })}
      dir="ltr"
      aria-invalid={invalid}
      spellCheck={false}
      autoComplete="off"
      className={`h-7 w-28 font-mono ${invalid ? "border-destructive" : ""}`}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const next = event.target.value.replace(/\s+/g, "");
        if (next) onCommit(next);
      }}
    />
  );
}

export default function App({ sdk }: { sdk: ShardSdk }) {
  const t = useT();
  const { locale } = useLocale();
  // A refused copy (no clipboard:write) is told to the user in the app; it is never a crash.
  const clipboard = useMemo(() => ({ writeText: (text: string) => sdk.clipboard.writeText(text), onError: (message: string) => void sdk.toast(message, "error").catch(() => {}) }), [sdk]);
  const [input, setInput] = useState("0 9 * * MON-FRI");
  const [zoneChoice, setZoneChoice] = useState(LOCAL_ZONE);
  const text = useDebouncedValue(input);
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || t("cron.localTime");
  const zones = useMemo(() => {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    return supported.filter((zone) => zone !== "UTC");
  }, []);

  const view = useMemo(() => {
    const read = readCronInput(text);
    const result = parseCron(read.expression, { aws: read.aws });
    const macroExpansion = result.ok ? result.schedule.expanded : undefined;
    const tokens = (macroExpansion ?? read.expression).trim().split(/\s+/).filter(Boolean);
    const layout = "schedule" in result ? result.schedule.fields.map((field) => field.name) : (result.layout ?? cronLayout(read.expression, read.aws));
    return { read, result, tokens, layout };
    // The error texts and field names are built while parsing, so a language change parses again.
  }, [text, t]);

  const { read, result, tokens, layout } = view;
  const zoneError = read.timeZone && !isValidTimeZone(read.timeZone) ? t("cron.error.unknownZone", { zone: read.timeZone }) : "";
  const timeZone = read.timeZone && !zoneError ? read.timeZone : zoneChoice === LOCAL_ZONE ? undefined : zoneChoice;
  const zoneLabel = timeZone ?? localZone;

  const runs = useMemo(() => {
    if (!result.ok || zoneError) return [];
    return nextCronRuns(result.schedule, new Date(), RUN_COUNT, timeZone);
  }, [result, timeZone, zoneError]);

  const hasSeconds = result.ok && result.schedule.fields[0].name === "second";
  const runFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(`${LOCALES[locale].tag}-u-nu-latn`, {
        timeZone,
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: hasSeconds ? "2-digit" : undefined,
        hourCycle: "h23",
        timeZoneName: "short",
      }),
    [timeZone, hasSeconds, locale],
  );

  const errorIndex = "error" in result ? result.fieldIndex : undefined;
  const fieldRows = layout && tokens.length === layout.length ? layout : null;
  const now = Date.now();

  return (
    <ClipboardProvider value={clipboard}>
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("cron.title")}</CardTitle>
          <CardDescription>{t("cron.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cron-expression">{t("cron.expression")}</Label>
            <div className="flex gap-2">
              <Input
                id="cron-expression"
                type="text"
                aria-label={t("cron.expressionAria")}
                dir="ltr"
                aria-invalid={!result.ok}
                aria-describedby="cron-description"
                spellCheck={false}
                autoComplete="off"
                placeholder={t("cron.placeholder")}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                className="font-mono"
              />
              <CopyButton value={read.expression} label={t("cron.copyExpression")} iconOnly />
              <select
                className={`${SELECT_CLASS} w-40 shrink-0`}
                aria-label={t("cron.examples")}
                value=""
                onChange={(event) => event.target.value && setInput(event.target.value)}
              >
                <option value="">{t("cron.examples")}</option>
                {CRON_EXAMPLES.map((example) => (
                  <option key={example.expression} value={example.expression}>
                    {t(`cron.example.${example.id}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div id="cron-description" className="space-y-1">
            {result.ok ? (
              <>
                <p className="text-base font-medium">{describeCron(result.schedule)}</p>
                <p className="text-xs text-muted-foreground">
                  {t("cron.readAs", { dialect: cronDialectLabel(result.schedule.dialect) })}
                  {result.schedule.expanded && (
                    <>
                      {" "}
                      <Rich text={t("cron.sameAs", { expression: `\`${result.schedule.expanded}\`` })} />
                    </>
                  )}
                  {result.schedule.dayOr && ` ${t("cron.dayOrNote")}`}
                </p>
              </>
            ) : (
              <div className="workspace-notice rounded-md" data-tone="error" role="alert">
                {"error" in result && result.error}
              </div>
            )}
            {read.command && (
              <p className="text-xs text-muted-foreground">
                <Rich text={t("cron.command", { command: `\`${read.command}\`` })} />
              </p>
            )}
          </div>

          {fieldRows && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" aria-label={t("cron.fields.aria")}>
                <thead className="text-start text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th scope="col" className="py-1.5 pe-2 font-medium">{t("cron.fields.field")}</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">{t("cron.fields.value")}</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">{t("cron.fields.meaning")}</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldRows.map((name, index) => {
                    const field = result.ok ? result.schedule.fields[index] : undefined;
                    const invalid = errorIndex === index;
                    return (
                      <tr key={name} className="border-b border-border/50">
                        <th scope="row" className="py-1.5 pe-2 text-start font-normal">{cronFieldLabel(name)}</th>
                        <td className="px-2 py-1.5">
                          <FieldInput
                            name={name}
                            value={tokens[index]}
                            invalid={invalid}
                            onCommit={(value) => setInput((current) => replaceCronField(current, index, value))}
                          />
                        </td>
                        <td className={`px-2 py-1.5 ${invalid ? "text-destructive" : ""}`}>
                          {field ? (
                            <>
                              <span className="block">{describeCronField(field)}</span>
                              {!field.wildcard && field.values.length > 0 && (
                                <span className="block font-mono text-muted-foreground" dir="ltr">{formatCronValues(field)}</span>
                              )}
                            </>
                          ) : invalid ? (
                            t("cron.fields.seeError")
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CronBuilder input={input} onChange={setInput} />
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {t("cron.nextRuns")}
            </CardTitle>
            <CardDescription>
              {read.timeZone && !zoneError ? t("cron.timesInPrefix", { zone: zoneLabel }) : t("cron.timesIn", { zone: zoneLabel })}
            </CardDescription>
          </div>
          <select
            className={`${SELECT_CLASS} w-48`}
            aria-label={t("cron.timeZone")}
            value={zoneChoice}
            onChange={(event) => setZoneChoice(event.target.value)}
            disabled={Boolean(read.timeZone && !zoneError)}
          >
            <option value={LOCAL_ZONE}>{t("cron.zone.local", { zone: localZone })}</option>
            <option value="UTC">UTC</option>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          {zoneError ? (
            <div className="workspace-notice rounded-md" data-tone="error" role="alert">{zoneError}</div>
          ) : runs.length > 0 ? (
            <div className="space-y-2">
              {runs.map((date) => (
                <div key={date.toISOString()} className="flex items-center gap-3 rounded-md bg-muted p-3">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <time dateTime={date.toISOString()} className="font-mono text-sm" dir="ltr">
                    {runFormatter.format(date)}
                  </time>
                  <span className="text-xs text-muted-foreground">{formatTimeUntil(date.getTime() - now)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {result.ok
                ? t("cron.neverRuns")
                : t("cron.fixExpression")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" />
            {t("cron.syntax.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              <Rich text={t("cron.syntax.format")} />
            </p>
            <ul className="ms-2 list-inside list-disc space-y-1">
              {(["wildcard", "list", "step", "names", "special", "macros"] as const).map((item) => (
                <li key={item}>
                  <Rich text={t(`cron.syntax.${item}`)} />
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <ToolFaqSection items={FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }))} />
    </div>
    </ClipboardProvider>
  );
}
