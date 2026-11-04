import { useState } from "react";
import { Button, Input } from "./ui";
import { useT } from "./lib/i18n";
import {
  parseCron,
  readCronInput,
  replaceCronField,
  cronFieldLabel,
  type CronField,
} from "./cron";
import { cronFieldValue, type BuilderMode } from "./cron-builder";
function Field({
  field,
  index,
  input,
  onChange,
}: {
  field: CronField;
  index: number;
  input: string;
  onChange: (text: string) => void;
}) {
  const t = useT();
  const label = cronFieldLabel(field.name);
  const [mode, setMode] = useState<BuilderMode>("custom");
  const [first, setFirst] = useState(field.text);
  const [second, setSecond] = useState("1");
  const [error, setError] = useState("");
  const apply = () => {
    try {
      const value = cronFieldValue(mode, first, second);
      const next = replaceCronField(input, index, value);
      const read = readCronInput(next);
      const parsed = parseCron(read.expression, { aws: read.aws });
      if (!parsed.ok)
        throw new Error("error" in parsed ? parsed.error : t("cron.builder.error.invalid"));
      setError("");
      onChange(next);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <fieldset className="border-t py-3 space-y-2">
      <legend className="text-sm font-medium">
        {label}{" "}
        <code className="text-muted-foreground" dir="ltr">{field.text}</code>
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border bg-background px-2 pe-7 py-1 text-sm"
          aria-label={t("cron.builder.mode", { field: label })}
          value={mode}
          onChange={(e) => {
            const m = e.target.value as BuilderMode;
            setMode(m);
            setFirst(m === "custom" ? field.text : "1");
            setError("");
          }}
        >
          <option value="custom">{t("cron.builder.custom")}</option>
          <option value="every">{t("cron.builder.every")}</option>
          <option value="specific">{t("cron.builder.specific")}</option>
          <option value="range">{t("cron.builder.range")}</option>
          <option value="interval">{t("cron.builder.interval")}</option>
        </select>
        {mode !== "every" && (
          <Input
            className="w-36 font-mono"
            aria-label={t(mode === "range" || mode === "interval" ? "cron.builder.start" : "cron.builder.values", { field: label })}
            dir="ltr"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
          />
        )}
        {(mode === "range" || mode === "interval") && (
          <Input
            className="w-28 font-mono"
            aria-label={t(mode === "range" ? "cron.builder.end" : "cron.builder.step", { field: label })}
            dir="ltr"
            value={second}
            onChange={(e) => setSecond(e.target.value)}
          />
        )}
        <Button variant="outline" onClick={apply}>
          {t(`cron.builder.apply.${field.name}`)}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
export function CronBuilder({
  input,
  onChange,
}: {
  input: string;
  onChange: (text: string) => void;
}) {
  const t = useT();
  const read = readCronInput(input);
  const parsed = parseCron(read.expression, { aws: read.aws });
  return (
    <details className="rounded-md border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        {t("cron.builder.title")}
      </summary>
      <div className="pt-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("cron.builder.hint")}
        </p>
        {parsed.ok ? (
          parsed.schedule.fields.map((field, index) => (
            <Field
              key={`${index}:${field.text}`}
              field={field}
              index={index}
              input={input}
              onChange={onChange}
            />
          ))
        ) : (
          <p className="text-sm">
            {t("cron.builder.invalid")}
          </p>
        )}
      </div>
    </details>
  );
}
