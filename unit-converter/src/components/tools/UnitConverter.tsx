import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight } from "lucide-react";
import { toast } from "@/shims/sonner";
import { useT, type TKey } from "@/lib/i18n";
import { conversions, formatResult } from "@/utils/unit-converter";

const unitLabel = (t: ReturnType<typeof useT>, key: string) => t(`unit.${key}` as TKey);

export function UnitConverter() {
  const t = useT();
  const [category, setCategory] = useState<string>("length");
  const [fromUnit, setFromUnit] = useState<string>("meter");
  const [toUnit, setToUnit] = useState<string>("kilometer");
  const [fromValue, setFromValue] = useState<string>("1");
  const [toValue, setToValue] = useState<string>("");

  const currentConversion = conversions[category];

  useEffect(() => {
    const unitKeys = Object.keys(currentConversion.units);
    if (unitKeys.length > 0) {
      const newFrom = unitKeys[0];
      const newTo = unitKeys.length > 1 ? unitKeys[1] : unitKeys[0];

      setFromUnit(newFrom);
      setToUnit(newTo);
    }
  }, [category]);

  useEffect(() => {
    if (!fromValue || isNaN(Number(fromValue))) {
      setToValue("");
      return;
    }

    try {
      const value = parseFloat(fromValue);
      const from = currentConversion.units[fromUnit];
      const to = currentConversion.units[toUnit];

      if (!from || !to) {
        setToValue("");
        return;
      }

      const baseValue = from.toBase(value);
      const result = to.fromBase(baseValue);

      setToValue(formatResult(result));   
    } catch (err) {
      console.error("Conversion error:", err);
      setToValue("");
    }
  }, [fromValue, fromUnit, toUnit, category]);

  const swapUnits = () => {
    const temp = fromUnit;
    setFromUnit(toUnit);
    setToUnit(temp);
    if (toValue) {
      setFromValue(toValue);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="space-y-2">
            <Label>{t("field.category")}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(conversions).map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(`category.${key}` as TKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-[1fr,auto,1fr] gap-4 items-end">
            <div className="space-y-2">
              <Label>{t("field.from")}</Label>
              <Select value={fromUnit} onValueChange={setFromUnit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(currentConversion.units).map(([key, unit]) => (
                    <SelectItem key={key} value={key}>
                      {unitLabel(t, key)} ({unit.symbol})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={swapUnits} variant="outline" size="icon" aria-label={t("action.swap")} title={t("action.swap")}>
              <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
            </Button>

            <div className="space-y-2">
              <Label>{t("field.to")}</Label>
              <Select value={toUnit} onValueChange={setToUnit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(currentConversion.units).map(([key, unit]) => (
                    <SelectItem key={key} value={key}>
                      {unitLabel(t, key)} ({unit.symbol})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="from-value">{t("field.value")}</Label>
              <Input
                id="from-value"
                type="number"
                value={fromValue}
                onChange={(e) => setFromValue(e.target.value)}
                placeholder={t("placeholder.value")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="to-value">{t("field.result")}</Label>
              <Input
                id="to-value"
                value={toValue}
                readOnly
                placeholder={t("field.result")}
                className="font-semibold"
              />
            </div>
          </div>

          <div className="p-4 bg-muted rounded-lg text-center">
            <p className="text-sm text-muted-foreground">
              {t("summary", {
                fromValue,
                fromUnit: unitLabel(t, fromUnit),
                toValue,
                toUnit: unitLabel(t, toUnit),
              })}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}