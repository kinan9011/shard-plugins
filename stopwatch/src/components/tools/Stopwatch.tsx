import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "./CopyButton";
import { saveFile } from "@/lib/desktop";
import { formatNumber, useT } from "@/lib/i18n";
import {
  elapsedAt,
  emptyStopwatch,
  formatElapsed,
  stopwatchAction,
  type StopwatchState,
} from "@/utils/stopwatch";
// Only the time display ticks, so the laps table does not render again on every frame.
function ElapsedTime({ state }: { state: StopwatchState }) {
  const t = useT();
  const ref = useRef<HTMLParagraphElement>(null);
  const [now, setNow] = useState(Date.now);
  const [visible, setVisible] = useState(true);
  const running = state.startedAt !== null;
  useEffect(() => {
    // The panel of a background tool tab is hidden, so stop ticking until it shows again.
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!running || !visible) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30);
    return () => window.clearInterval(timer);
  }, [running, visible]);
  return (
    <p
      ref={ref}
      dir="ltr"
      className="font-mono text-4xl sm:text-6xl tabular-nums text-start"
      aria-label={t("time.label")}
    >
      {formatElapsed(elapsedAt(state, Math.max(now, state.startedAt ?? 0)))}
    </p>
  );
}
const LapTable = memo(function LapTable({ laps }: { laps: number[] }) {
  const t = useT();
  return (
    <table className="w-full text-sm text-start">
      <thead>
        <tr>
          <th className="p-2 text-start">{t("table.lap")}</th>
          <th className="text-start">{t("table.split")}</th>
          <th className="text-start">{t("table.total")}</th>
        </tr>
      </thead>
      <tbody>
        {laps.map((total, i) => (
          <tr key={i} className="border-t">
            <td className="p-2">{formatNumber(i + 1)}</td>
            <td className="font-mono" dir="ltr">
              {formatElapsed(total - (laps[i - 1] ?? 0))}
            </td>
            <td className="font-mono" dir="ltr">{formatElapsed(total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});
/** A CSV field, quoted when the translated heading holds a comma or a quote. */

export function Stopwatch() {
  const t = useT();
  const [state, setState] = useState(emptyStopwatch);
  const [error, setError] = useState("");
  const running = state.startedAt !== null;
  const act = (action: "start" | "pause" | "lap" | "reset") => {
    const time = Date.now();
    setState((s) => stopwatchAction(s, action, time));
  };
  const csv = useMemo(
    () =>
      [
        "Lap,Split,Total", // fixed: a data file reads the same in every language
        ...state.laps.map(
          (total, i) =>
            `${i + 1},${formatElapsed(total - (state.laps[i - 1] ?? 0))},${formatElapsed(total)}`,
        ),
      ].join("\n"),
    [state.laps],
  );
  return (
    <section className="space-y-6" aria-label={t("title")}>
      <div className="rounded-lg border p-6 space-y-6">
        <ElapsedTime state={state} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => act(running ? "pause" : "start")}>
            {running ? t("action.pause") : state.elapsed ? t("action.resume") : t("action.start")}
          </Button>
          <Button
            variant="outline"
            disabled={!running}
            onClick={() => act("lap")}
          >
            {t("action.lap")}
          </Button>
          <Button
            variant="outline"
            disabled={!running && !state.elapsed}
            onClick={() => act("reset")}
          >
            {t("action.reset")}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("note")}
        </p>
      </div>
      {state.laps.length > 0 ? (
        <div className="space-y-3">
          <div className="flex gap-3">
            <CopyButton value={csv} label={t("action.copyLaps")} />
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await saveFile(
                    new Blob([csv], { type: "text/csv" }),
                    "stopwatch-laps.csv",
                  );
                } catch {
                  setError(t("error.save"));
                }
              }}
            >
              {t("action.exportLaps")}
            </Button>
          </div>
          <LapTable laps={state.laps} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("empty.laps")}
        </p>
      )}
      {error && (
        <p role="alert" className="workspace-notice" data-tone="error">
          {error}
        </p>
      )}
    </section>
  );
}
