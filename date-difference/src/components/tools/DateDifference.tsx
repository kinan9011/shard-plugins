import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, ArrowRight } from "lucide-react";
import { formatNumber, useT } from "@/lib/i18n";

export function DateDifference() {
  const t = useT();
  const [date1, setDate1] = useState("");
  const [date2, setDate2] = useState("");
  const [time1, setTime1] = useState("00:00");
  const [time2, setTime2] = useState("00:00");
  useEffect(() => {
    // Set default dates
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    setDate2(formatDateForInput(today));
    setDate1(formatDateForInput(yesterday));
  }, []);

  const formatDateForInput = (date: Date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };

  const calculateDifference = () => {
    if (!date1 || !date2) {
      return null;
    }

    const d1 = new Date(`${date1}T${time1}`);
    const d2 = new Date(`${date2}T${time2}`);

    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      return null;
    }

    const diffMs = Math.abs(d2.getTime() - d1.getTime());
    const isNegative = d2 < d1;

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    return {
      diffMs,
      isNegative,
      breakdown: {
        milliseconds: diffMs,
        seconds,
        minutes,
        hours,
        days,
        weeks,
        months,
        years,
      },
    };
  };

  const difference = calculateDifference();

  const setDateToNow = (position: "first" | "second") => {
    const current = new Date();
    const date = formatDateForInput(current);
    const time = current.toTimeString().slice(0, 5);
    if (position === "first") {
      setDate1(date);
      setTime1(time);
    } else {
      setDate2(date);
      setTime2(time);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("card.title")}</CardTitle>
          <CardDescription>{t("card.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6">
            {/* First Date */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>{t("date.first")}</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDateToNow("first")}
                >
                  <Clock className="h-3 w-3 me-1" />
                  {t("action.now")}
                </Button>
              </div>
              <input
                type="date"
                aria-label={t("date.firstDate")}
                value={date1}
                onChange={(e) => setDate1(e.target.value)}
                className="w-full px-3 py-2 rounded-md border bg-background"
              />
              <input
                type="time"
                aria-label={t("date.firstTime")}
                value={time1}
                onChange={(e) => setTime1(e.target.value)}
                className="w-full px-3 py-2 rounded-md border bg-background"
              />
            </div>

            {/* Arrow */}
            <div className="hidden md:flex items-center justify-center">
              <ArrowRight className="h-6 w-6 text-muted-foreground rtl:-scale-x-100" />
            </div>

            {/* Second Date */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>{t("date.second")}</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDateToNow("second")}
                >
                  <Clock className="h-3 w-3 me-1" />
                  {t("action.now")}
                </Button>
              </div>
              <input
                type="date"
                aria-label={t("date.secondDate")}
                value={date2}
                onChange={(e) => setDate2(e.target.value)}
                className="w-full px-3 py-2 rounded-md border bg-background"
              />
              <input
                type="time"
                aria-label={t("date.secondTime")}
                value={time2}
                onChange={(e) => setTime2(e.target.value)}
                className="w-full px-3 py-2 rounded-md border bg-background"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {difference && (
        <Card>
          <CardHeader>
            <CardTitle>{t("result.title")}</CardTitle>
            <CardDescription>
              {difference.isNegative ? t("result.earlier") : t("result.later")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">{formatNumber(difference.breakdown.years)}</div>
                <div className="text-sm text-muted-foreground">{t("unit.years")}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">{formatNumber(difference.breakdown.months)}</div>
                <div className="text-sm text-muted-foreground">{t("unit.months")}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">{formatNumber(difference.breakdown.weeks)}</div>
                <div className="text-sm text-muted-foreground">{t("unit.weeks")}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">{formatNumber(difference.breakdown.days)}</div>
                <div className="text-sm text-muted-foreground">{t("unit.days")}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">{formatNumber(difference.breakdown.hours)}</div>
                <div className="text-sm text-muted-foreground">{t("unit.hours")}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">{formatNumber(difference.breakdown.minutes)}</div>
                <div className="text-sm text-muted-foreground">{t("unit.minutes")}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">{formatNumber(difference.breakdown.seconds)}</div>
                <div className="text-sm text-muted-foreground">{t("unit.seconds")}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">{formatNumber(difference.breakdown.milliseconds)}</div>
                <div className="text-sm text-muted-foreground">{t("unit.milliseconds")}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
