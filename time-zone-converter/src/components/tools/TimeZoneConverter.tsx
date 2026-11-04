import { useMemo, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUpToLine, X } from "lucide-react";
import { CopyButton } from "@/components/tools/CopyButton";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import {
  formatInTimeZone,
  getLocalTimeZone,
  getWallClock,
  isValidTimeZone,
  listTimeZones,
  loadSavedTimeZones,
  saveTimeZones,
} from "@/utils/timestamp";
import { t as tNow, useT } from "@/lib/i18n";
import { canonicalTimeZone, dayShift, formatWallClockInput, parseWallClockInput, resolveWallClock } from "@/utils/time-zone";

const FAQ_KEYS = ["utc", "dst", "convertFrom", "data"] as const;

const storage = () => (typeof window !== "undefined" ? window.localStorage : undefined);

const formatShift = (days: number) => (days === 0 ? "" : tNow("row.dayShift", { count: Math.abs(days), sign: days > 0 ? "+" : "−" }));

export function TimeZoneConverter() {
  const t = useT();
  const localZone = useMemo(() => {
    const zone = getLocalTimeZone();
    return isValidTimeZone(zone) ? zone : "UTC";
  }, []);
  // Some engines leave UTC out of the list
  const zoneOptions = useMemo(() => Array.from(new Set(["UTC", ...listTimeZones()])), []);

  const [value, setValue] = useState(() => formatWallClockInput(getWallClock(Date.now(), localZone)));
  const [fromZone, setFromZone] = useState(localZone);
  const [fromDraft, setFromDraft] = useState(localZone);
  const [useLater, setUseLater] = useState(false);
  const [zones, setZones] = useState<string[]>(() => loadSavedTimeZones(storage()));
  const [zoneDraft, setZoneDraft] = useState("");
  const [zoneError, setZoneError] = useState("");

  const clock = parseWallClockInput(value);
  const resolution = clock ? resolveWallClock(clock, fromZone) : null;
  const ms = resolution?.kind === "overlap" && useLater ? resolution.laterMs : resolution?.ms;
  const fromDraftInvalid = fromDraft.trim() !== "" && canonicalTimeZone(fromDraft, zoneOptions) === null;

  const setInput = (next: string) => {
    setValue(next);
    setUseLater(false);
  };

  const setSource = (zone: string) => {
    setFromZone(zone);
    setFromDraft(zone);
    setUseLater(false);
  };

  const changeFromDraft = (typed: string) => {
    setFromDraft(typed);
    const zone = canonicalTimeZone(typed, zoneOptions);
    if (zone) {
      setFromZone(zone);
      setUseLater(false);
    }
  };

  // Keep the same moment and read it on the clock of another zone
  const convertFrom = (zone: string) => {
    if (ms === undefined) return;
    setSource(zone);
    setValue(formatWallClockInput(getWallClock(ms, zone)));
  };

  const updateZones = (next: string[]) => {
    setZones(next);
    saveTimeZones(storage(), next);
  };

  const addZone = () => {
    const typed = zoneDraft.trim();
    if (!typed) return;
    const zone = canonicalTimeZone(typed, zoneOptions);
    if (!zone) {
      setZoneError(t("error.unknownZone", { zone: typed }));
      return;
    }
    if (!zones.includes(zone)) updateZones([...zones, zone]);
    setZoneDraft("");
    setZoneError("");
  };

  const onZoneKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addZone();
    }
  };

  const rows = [
    { zone: "UTC", label: "UTC", saved: false },
    { zone: localZone, label: t("row.local", { zone: localZone }), saved: false },
    ...zones.map((zone) => ({ zone, label: zone, saved: true })),
  ].filter((row, index, all) => all.findIndex((other) => other.zone === row.zone) === index);

  let note = "";
  if (resolution?.kind === "gap") {
    note = t("note.gap", { zone: fromZone, count: resolution.gapMinutes });
  } else if (resolution?.kind === "overlap") {
    const offset = (at: number) => formatInTimeZone(at, fromZone).offset;
    note = t(useLater ? "note.overlapSecond" : "note.overlapFirst", { zone: fromZone, offset: offset(useLater ? resolution.laterMs : resolution.ms) });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="datetime-local"
              step={1}
              aria-label={t("input.dateTime")}
              value={value}
              onChange={(event) => setInput(event.target.value)}
              className="w-auto font-mono"
            />
            <button
              type="button"
              className="toolbar-text-button"
              onClick={() => setInput(formatWallClockInput(getWallClock(Date.now(), fromZone)))}
            >
              {t("action.now")}
            </button>
            <label className="flex min-w-[16rem] flex-1 items-center gap-2 text-sm">
              {t("input.from")}
              <Input
                aria-label={t("input.fromZone")}
                list="time-zone-converter-options"
                placeholder={t("input.fromPlaceholder")}
                value={fromDraft}
                onChange={(event) => changeFromDraft(event.target.value)}
                onBlur={() => setFromDraft(fromZone)}
                className="font-mono"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          </div>
          {fromDraftInvalid && (
            <div className="workspace-notice" data-tone="error" role="alert">
              {t("error.unknownFrom", { zone: fromDraft.trim(), current: fromZone })}
            </div>
          )}
          {!clock && (
            <div className="workspace-notice" data-tone="error" role="alert">{t("error.enterDateTime")}</div>
          )}
          {note && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted-foreground" role="status">{note}</p>
              {resolution?.kind === "overlap" && (
                <button type="button" className="toolbar-text-button" onClick={() => setUseLater(!useLater)}>
                  {t(useLater ? "action.useFirst" : "action.useSecond")}
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("converted.title")}</CardTitle>
          <CardDescription>{t("converted.description", { zone: fromZone })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ms !== undefined && (
            <dl className="space-y-1.5">
              {rows.map(({ zone, label, saved }) => {
                const { dateTime, offset } = formatInTimeZone(ms, zone);
                const text = `${dateTime} ${offset}`;
                const shift = formatShift(dayShift(ms, fromZone, zone));
                return (
                  <div key={zone} className="flex items-center gap-3 rounded-md bg-muted px-3 py-2">
                    <dt className="w-36 shrink-0 break-all text-xs text-muted-foreground" dir="auto">{label}</dt>
                    <dd className="min-w-0 flex-1 break-words font-mono text-sm" dir="ltr">{text}</dd>
                    {shift && <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">{shift}</span>}
                    <CopyButton value={text} ariaLabel={t("action.copyRow", { label })} iconOnly />
                    <button
                      type="button"
                      className="toolbar-text-button"
                      aria-label={t("action.convertFrom", { zone })}
                      title={t("action.convertFromTitle")}
                      disabled={zone === fromZone}
                      onClick={() => convertFrom(zone)}
                    >
                      <ArrowUpToLine size={14} />
                    </button>
                    {saved && (
                      <button
                        type="button"
                        className="toolbar-text-button"
                        aria-label={t("action.remove", { zone })}
                        onClick={() => updateZones(zones.filter((item) => item !== zone))}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </dl>
          )}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                aria-label={t("input.addZone")}
                list="time-zone-converter-options"
                placeholder={t("input.addPlaceholder")}
                value={zoneDraft}
                onChange={(event) => {
                  setZoneDraft(event.target.value);
                  setZoneError("");
                }}
                onKeyDown={onZoneKeyDown}
                className="font-mono"
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" className="toolbar-text-button" onClick={addZone} disabled={!zoneDraft.trim()}>
                {t("action.add")}
              </button>
            </div>
            {zoneError && <div className="workspace-notice" data-tone="error" role="alert">{zoneError}</div>}
          </div>
          <datalist id="time-zone-converter-options">
            {zoneOptions.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </CardContent>
      </Card>

      <ToolFaqSection items={FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }))} />
    </div>
  );
}
