import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/tools/CopyButton";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { t, useT } from "@/lib/i18n";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  byteSwap,
  fixedWidth,
  groupDigits,
  highestSetBit,
  lowestSetBit,
  popcount,
  toBase,
  toggleBit,
  toRoman,
} from "@/utils/number-base";
import { readNumberInput, type ReadResult } from "@/utils/int-expression";

type InputBase = "auto" | 2 | 8 | 10 | 16 | "custom" | "roman";

const INPUT_BASES: { value: InputBase; label: "base.auto" | "base.bin" | "base.oct" | "base.dec" | "base.hex" | "base.custom" | "base.roman" }[] = [
  { value: "auto", label: "base.auto" },
  { value: 2, label: "base.bin" },
  { value: 8, label: "base.oct" },
  { value: 10, label: "base.dec" },
  { value: 16, label: "base.hex" },
  { value: "custom", label: "base.custom" },
  { value: "roman", label: "base.roman" },
];

// "id" is the stable English name (test ids); "label" is the translated one.
const OUTPUTS: { base: number; id: string; label: "output.binary" | "output.octal" | "output.decimal" | "output.hex"; group: number }[] = [
  { base: 2, id: "Binary", label: "output.binary", group: 4 },
  { base: 8, id: "Octal", label: "output.octal", group: 3 },
  { base: 10, id: "Decimal", label: "output.decimal", group: 3 },
  { base: 16, id: "Hexadecimal", label: "output.hex", group: 4 },
];

const WIDTHS = [8, 16, 32, 64] as const;

const SOURCE_KEYS: Record<number, "source.binary" | "source.octal" | "source.decimal" | "source.hex"> = {
  2: "source.binary",
  8: "source.octal",
  10: "source.decimal",
  16: "source.hex",
};
const PREFIXES: Record<number, string> = { 2: "0b", 8: "0o", 16: "0x" };

function describeSource(parsed: ReadResult): string {
  if ("error" in parsed) return "";
  if (parsed.source === "expression") return t("source.expression");
  if (parsed.source === "roman") return t("source.roman");
  // Type-only cast: `base` is always set for a literal (strict mode cannot see that).
  const base = parsed.base as number;
  const key = SOURCE_KEYS[base];
  return key ? t(key) : t("source.base", { base });
}

/** Write a value back into the input field in the form the user typed, so a bit toggle keeps the base. */
function formatForInput(value: bigint, inputBase: InputBase, customBase: number | null, parsed: ReadResult): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  if (inputBase === "custom") return customBase ? sign + toBase(abs, customBase) : value.toString();
  if (typeof inputBase === "number") return sign + toBase(abs, inputBase);
  const base = ("base" in parsed && parsed.base) || 10;
  return sign + (PREFIXES[base] ?? "") + toBase(abs, base);
}

const FAQ_KEYS = ["inputBase", "separators", "exact", "group", "fixed", "expression", "rules", "bitGrid", "roman", "custom"] as const;

function ValueRow({ id, label, value, display }: { id: string; label: string; value: string; display: string }) {
  const t = useT();
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code dir="ltr" className="flex-1 break-all rounded bg-muted p-2 font-mono text-sm" data-testid={`value-${id}`}>
          {display}
        </code>
        <CopyButton value={value} label={t("copy.value", { label })} iconOnly />
      </div>
    </div>
  );
}

function BitGrid({ unsigned, bits, onToggle }: { unsigned: bigint; bits: number; onToggle: (bit: number) => void }) {
  const t = useT();
  const high = highestSetBit(unsigned);
  const low = lowestSetBit(unsigned);
  const swapped = toBase(byteSwap(unsigned, bits), 16).padStart(bits / 4, "0");
  // One group per byte, most significant byte first.
  const bytes = Array.from({ length: bits / 8 }, (_, i) => bits / 8 - 1 - i);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-3 gap-y-2" dir="ltr" role="group" aria-label={t("bits.label")}>
        {bytes.map((byte) => (
          <div key={byte} className="space-y-0.5">
            <div className="flex">
              {Array.from({ length: 8 }, (_, i) => {
                const bit = byte * 8 + 7 - i;
                const set = ((unsigned >> BigInt(bit)) & 1n) === 1n;
                return (
                  <button
                    key={bit}
                    type="button"
                    aria-label={t("bit.label", { bit })}
                    aria-pressed={set}
                    title={t("bit.label", { bit })}
                    onClick={() => onToggle(bit)}
                    className={`h-7 w-6 border-y border-s font-mono text-xs last:border-e first:rounded-s last:rounded-e ${
                      set ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {set ? 1 : 0}
                  </button>
                );
              })}
            </div>
            <p className="text-center font-mono text-[10px] text-muted-foreground">
              {byte * 8 + 7}:{byte * 8}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="bit-stats">
        {t("bits.stats", { set: popcount(unsigned), high: high ?? t("bits.none"), low: low ?? t("bits.none") })}
      </p>
      <ValueRow id="Byte-swapped hex" label={t("output.byteSwapped")} value={swapped} display={swapped} />
    </div>
  );
}

export function NumberBaseConverter() {
  const t = useT();
  const [input, setInput] = useState("");
  const [inputBase, setInputBase] = useState<InputBase>("auto");
  const [customText, setCustomText] = useState("36");
  const [grouped, setGrouped] = useState(false);
  const [width, setWidth] = useState<(typeof WIDTHS)[number]>(32);
  const pendingInput = useDebouncedValue(input);

  const customNumber = Number(customText);
  const customBase = Number.isInteger(customNumber) && customNumber >= 2 && customNumber <= 36 ? customNumber : null;

  const parsed = useMemo(() => {
    if (!pendingInput.trim()) return null;
    if (inputBase === "custom") {
      return customBase ? readNumberInput(pendingInput, customBase, width) : null;
    }
    return readNumberInput(pendingInput, inputBase, width);
  }, [pendingInput, inputBase, customBase, width, t]);

  const value = parsed && !("error" in parsed) ? parsed.value : null;
  const show = (digits: string, size: number) => (grouped && size > 0 ? groupDigits(digits, size) : digits);
  const fixed = value === null ? null : fixedWidth(value, width);
  const roman = value === null ? null : toRoman(value);

  // Read the live input, not the debounced value, so quick clicks do not lose a toggle.
  const flipBit = (bit: number) => {
    const base = inputBase === "custom" ? customBase : inputBase;
    if (base === null) return;
    const current = readNumberInput(input, base, width);
    if ("error" in current) return;
    const next = toggleBit(current.value, bit, width);
    const nextRoman = inputBase === "roman" ? toRoman(next) : null;
    if (inputBase === "roman" && !nextRoman) setInputBase("auto");
    setInput(nextRoman ?? formatForInput(next, inputBase === "roman" ? "auto" : inputBase, customBase, current));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="number-input">{t("input.label")}</Label>
            <Input
              id="number-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={inputBase === "roman" ? "MCMXCIV" : "255, 0xFF, 0b1010, (1 << 8) - 1"}
              className="font-mono"
              dir="ltr"
              spellCheck={false}
              autoComplete="off"
            />
            {parsed && "error" in parsed && (
              <p className="text-xs text-destructive" role="alert">
                {parsed.error}
              </p>
            )}
            {parsed?.ok && (
              <p className="text-xs text-muted-foreground" role="status">
                {describeSource(parsed)}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="layout-switch" role="group" aria-label={t("base.label")}>
              {INPUT_BASES.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={inputBase === option.value}
                  onClick={() => setInputBase(option.value)}
                >
                  {t(option.label)}
                </button>
              ))}
            </div>
            <label className="option-switch" htmlFor="number-group">
              {t("option.group")}
              <Switch id="number-group" checked={grouped} onCheckedChange={setGrouped} />
            </label>
            <div className="flex items-center gap-2">
              <Label htmlFor="number-custom-base" className="text-xs">
                {t("base.customLabel")}
              </Label>
              <Input
                id="number-custom-base"
                type="number"
                min={2}
                max={36}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                className="h-8 w-20 font-mono"
                dir="ltr"
                aria-invalid={!customBase}
              />
            </div>
          </div>
          {!customBase && (
            <p className="text-xs text-destructive" role="alert">
              {t("error.customBase")}
            </p>
          )}

          {value !== null && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {OUTPUTS.map(({ base, id, label, group }) => {
                const digits = toBase(value, base);
                return <ValueRow key={base} id={id} label={t(label)} value={digits} display={show(digits, group)} />;
              })}
              {customBase && (
                <ValueRow
                  id={`Base ${customBase}`}
                  label={t("output.base", { base: customBase })}
                  value={toBase(value, customBase)}
                  display={toBase(value, customBase)}
                />
              )}
              {roman ? (
                <ValueRow id="Roman" label={t("output.roman")} value={roman} display={roman} />
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("output.roman")}</Label>
                  <p className="p-2 text-sm text-muted-foreground" data-testid="value-Roman">
                    {t("output.noRoman")}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {fixed && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle>{t("fixed.title")}</CardTitle>
              <CardDescription>
                {t("fixed.description")}
              </CardDescription>
            </div>
            <div className="layout-switch" role="group" aria-label={t("fixed.width")}>
              {WIDTHS.map((bits) => (
                <button key={bits} type="button" aria-pressed={width === bits} onClick={() => setWidth(bits)}>
                  {t("fixed.bits", { bits })}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {fixed.fits ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <ValueRow id="Signed" label={t("output.signed")} value={fixed.signed.toString()} display={show(fixed.signed.toString(), 3)} />
                  <ValueRow
                    id="Unsigned"
                    label={t("output.unsigned")}
                    value={fixed.unsigned.toString()}
                    display={show(fixed.unsigned.toString(), 3)}
                  />
                  <ValueRow id={`Hex (${width}-bit)`} label={t("output.hexBits", { bits: width })} value={fixed.hex} display={show(fixed.hex, 4)} />
                  <ValueRow id={`Binary (${width}-bit)`} label={t("output.binaryBits", { bits: width })} value={fixed.binary} display={show(fixed.binary, 4)} />
                </div>
                <BitGrid unsigned={fixed.unsigned} bits={width} onToggle={flipBit} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" role="status">
                {t("fixed.noFit", { count: width })}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />
    </div>
  );
}
