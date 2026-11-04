import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useToolActive } from "@/hooks/useToolActive";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { X } from "lucide-react";
import { CopyButton } from "@/components/tools/CopyButton";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { autoDir, formatNumber, useT, type TKey } from "@/lib/i18n";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  formatInTimeZone,
  formatIsoWithOffset,
  formatRelativeTime,
  getCalendarInfo,
  getLocalTimeZone,
  isValidTimeZone,
  listTimeZones,
  loadSavedTimeZones,
  parseTimeInput,
  saveTimeZones,
  type TimeParseResult,
} from "@/utils/timestamp";

const FAQ_KEYS = ["input", "unit", "offset", "months", "zone", "zones"] as const;

/** Plain-language note about how the input was read. */
function describeSource(result: Extract<TimeParseResult, { ok: true }>, localZone: string, t: (key: TKey, vars?: Record<string, string | number>) => string): string {
  const base = (() => {
    switch (result.source) {
      case "now":
        return t("source.now");
      case "date":
        if (result.zone === "utc") return t("source.dateUtc");
        if (result.zone === "local") return t("source.dateLocal", { zone: localZone });
        return t("source.dateExplicit");
      default:
        return t(`source.${result.source}`);
    }
  })();
  if (!result.offsetMs) return base;
  const seconds = result.offsetMs / 1000;
  return `${base} ${t("source.offset", { seconds: formatNumber(seconds, { signDisplay: "exceptZero" }) })}`;
}

function ResultRow({ label, value }: { label: string; value: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 rounded-md bg-muted px-3 py-2">
      <dt className="w-36 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd dir="auto" className="min-w-0 flex-1 break-all font-mono text-sm">{value}</dd>
      <CopyButton value={value} ariaLabel={t("copy.label", { label })} iconOnly />
    </div>
  );
}

export function TimestampConverter() {
  const t = useT();
  const [input, setInput] = useState("");
  const debouncedInput = useDebouncedValue(input);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [zones, setZones] = useState<string[]>(() =>
    loadSavedTimeZones(typeof window !== "undefined" ? window.localStorage : undefined),
  );
  const [zoneDraft, setZoneDraft] = useState("");
  const [zoneError, setZoneError] = useState("");
  const localZone = useMemo(getLocalTimeZone, []);
  const zoneOptions = useMemo(listTimeZones, []);

  // Tick every second so "now" and the relative time stay current, while the tab is in front.
  const toolActive = useToolActive();
  useEffect(() => {
    if (!toolActive) return;
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [toolActive]);

  const result = parseTimeInput(debouncedInput, nowMs);

  const updateZones = (next: string[]) => {
    setZones(next);
    saveTimeZones(typeof window !== "undefined" ? window.localStorage : undefined, next);
  };

  const addZone = () => {
    const typed = zoneDraft.trim();
    if (!typed) return;
    if (!isValidTimeZone(typed)) {
      setZoneError(t("zone.unknown", { zone: typed }));
      return;
    }
    // Use the listed spelling so "asia/tokyo" and "Asia/Tokyo" are the same entry.
    // resolvedOptions() is no help here: it can return old names such as Asia/Calcutta.
    const zone = zoneOptions.find((option) => option.toLowerCase() === typed.toLowerCase()) ?? typed;
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

  const zoneRow = (zone: string | undefined) => {
    const { dateTime, offset } = formatInTimeZone(result.ok ? result.ms : nowMs, zone);
    return `${dateTime} ${offset}`;
  };

  let rows: { label: string; value: string }[] = [];
  if (result.ok) {
    const { ms } = result;
    const calendar = getCalendarInfo(ms);
    rows = [
      { label: t("row.unixSeconds"), value: String(Math.floor(ms / 1000)) },
      { label: t("row.unixMilliseconds"), value: String(ms) },
      { label: t("row.isoUtc"), value: new Date(ms).toISOString() },
      { label: t("row.isoLocal"), value: formatIsoWithOffset(ms) },
      { label: t("row.rfc"), value: new Date(ms).toUTCString() },
      { label: t("row.relative"), value: formatRelativeTime(ms, nowMs) },
      {
        label: t("row.calendar"),
        value: t("row.calendarValue", { weekday: calendar.weekday, day: calendar.dayOfYear, days: calendar.daysInYear, week: `${calendar.isoWeekYear}-W${String(calendar.isoWeek).padStart(2, "0")}` }),
      },
    ];
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("card.timestamp")}</CardTitle>
          <CardDescription>{t("card.timestampHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Input
              id="timestamp-input"
              type="text"
              aria-label={t("input.label")}
              placeholder={t("input.placeholder")}
              dir={autoDir(input)}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              className="font-mono"
              spellCheck={false}
              autoComplete="off"
            />
            {result.ok ? (
              <p className="text-xs text-muted-foreground" role="status">{describeSource(result, localZone, t)}</p>
            ) : (
              <div className="workspace-notice" data-tone="error" role="alert">{"error" in result && result.error}</div>
            )}
          </div>

          {result.ok && (
            <dl className="space-y-1.5">
              {rows.map((row) => (
                <ResultRow key={row.label} label={row.label} value={row.value} />
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("card.zones")}</CardTitle>
          <CardDescription>{t("card.zonesHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="space-y-1.5">
            <ResultRow label={t("row.local", { zone: localZone })} value={zoneRow(undefined)} />
            {zones.map((zone) => (
              <div key={zone} className="flex items-center gap-3 rounded-md bg-muted px-3 py-2">
                <dt className="w-36 shrink-0 break-all text-xs text-muted-foreground">{zone}</dt>
                <dd dir="auto" className="min-w-0 flex-1 break-all font-mono text-sm">{zoneRow(zone)}</dd>
                <CopyButton value={zoneRow(zone)} ariaLabel={t("copy.label", { label: zone })} iconOnly />
                <button
                  type="button"
                  className="toolbar-text-button"
                  aria-label={t("zone.remove", { zone })}
                  onClick={() => updateZones(zones.filter((item) => item !== zone))}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </dl>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                aria-label={t("zone.addLabel")}
                list="timestamp-zone-options"
                placeholder={t("zone.addPlaceholder")}
                dir={autoDir(zoneDraft)}
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
                {t("zone.add")}
              </button>
            </div>
            <datalist id="timestamp-zone-options">
              {zoneOptions.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            {zoneError && <div className="workspace-notice" data-tone="error" role="alert">{zoneError}</div>}
          </div>
        </CardContent>
      </Card>

      <ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />
    </div>
  );
}
