import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { autoDir, useT } from "@/lib/i18n";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  CHARACTER_SETS,
  LENGTH_LIMITS,
  MAX_COUNT,
  alphabetForMode,
  buildAlphabet,
  entropyForOptions,
  generateRandomStrings,
  isByteMode,
  validateAlphabet,
  type CharacterSet,
  type RandomStringMode,
} from "@/utils/random-string";

const FAQ_KEYS = ["nanoid", "token", "entropy", "bytes", "sent"] as const;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const parseWhole = (text: string, fallback: number, min: number, max: number) => {
  const value = Number.parseInt(text, 10);
  return Number.isNaN(value) ? fallback : clamp(value, min, max);
};

export function RandomString() {
  const t = useT();
  const [mode, setMode] = useState<RandomStringMode>("nanoid");
  const [lengthText, setLengthText] = useState<Record<RandomStringMode, string>>({
    nanoid: String(LENGTH_LIMITS.nanoid.fallback),
    custom: String(LENGTH_LIMITS.custom.fallback),
    hex: String(LENGTH_LIMITS.hex.fallback),
    base64url: String(LENGTH_LIMITS.base64url.fallback),
  });
  const [countText, setCountText] = useState("5");
  const [prefix, setPrefix] = useState("");
  const [sets, setSets] = useState<Record<CharacterSet, boolean>>({ lowercase: true, uppercase: true, digits: true, symbols: false });
  const [customAlphabet, setCustomAlphabet] = useState("");
  const [nonce, setNonce] = useState(0);
  const [output, setOutput] = useState("");

  const limits = LENGTH_LIMITS[mode];
  const length = parseWhole(lengthText[mode], limits.fallback, limits.min, limits.max);
  const count = parseWhole(countText, 1, 1, MAX_COUNT);
  const pendingPrefix = useDebouncedValue(prefix);
  const pendingAlphabet = useDebouncedValue(customAlphabet);

  const alphabet = useMemo(
    () => (mode === "custom" ? buildAlphabet(sets, pendingAlphabet) : alphabetForMode(mode)),
    [mode, sets, pendingAlphabet],
  );
  const error = mode === "custom" ? validateAlphabet(alphabet) : "";
  const bits = error ? 0 : entropyForOptions({ mode, length, alphabet });
  const byteMode = isByteMode(mode);

  useEffect(() => {
    if (error) {
      setOutput("");
      return;
    }
    setOutput(generateRandomStrings({ mode, length, count, prefix: pendingPrefix, alphabet }).join("\n"));
  }, [mode, length, count, pendingPrefix, alphabet, error, nonce]);

  const setLength = (value: string) => setLengthText((current) => ({ ...current, [mode]: value }));

  return (
    <ToolWorkspace
      id="random-string"
      toolbar={
        <>
          <Tabs value={mode} onValueChange={(v) => setMode(v as RandomStringMode)}>
            <TabsList aria-label={t("mode.label")}>
              <TabsTrigger value="nanoid">Nano ID</TabsTrigger>
              <TabsTrigger value="custom">{t("mode.custom")}</TabsTrigger>
              <TabsTrigger value="hex">Hex</TabsTrigger>
              <TabsTrigger value="base64url">Base64URL</TabsTrigger>
            </TabsList>
          </Tabs>
          <button type="button" className="toolbar-text-button indent-control" onClick={() => setNonce((n) => n + 1)} disabled={Boolean(error)}>
            <RefreshCw size={14} aria-hidden="true" />
            {t("action.regenerate")}
          </button>
        </>
      }
      notice={error ? <div className="workspace-notice" data-tone="error" role="alert">{error}</div> : undefined}
      first={
        <EditorPane title={t("pane.options")}>
          <div className="pane-options">
            <label htmlFor="random-length" className="w-20 font-medium">{byteMode ? t("option.bytes") : t("option.length")}</label>
            <Slider
              className="min-w-32 flex-1"
              value={[length]}
              onValueChange={([value]) => setLength(String(value))}
              min={limits.min}
              max={limits.max}
              step={1}
              aria-label={byteMode ? t("option.bytesSlider") : t("option.lengthSlider")}
            />
            <Input
              id="random-length"
              type="number"
              min={limits.min}
              max={limits.max}
              className="h-7 w-20 text-xs"
              value={lengthText[mode]}
              onChange={(e) => setLength(e.target.value)}
              onBlur={() => setLength(String(length))}
            />
          </div>
          <div className="pane-options">
            <label htmlFor="random-count" className="w-20 font-medium">{t("option.count")}</label>
            <Input
              id="random-count"
              type="number"
              min={1}
              max={MAX_COUNT}
              className="h-7 w-20 text-xs"
              value={countText}
              onChange={(e) => setCountText(e.target.value)}
              onBlur={() => setCountText(String(count))}
            />
            <span className="text-muted-foreground">{t("option.countRange", { max: MAX_COUNT })}</span>
          </div>
          <div className="pane-options">
            <label htmlFor="random-prefix" className="w-20 font-medium">{t("option.prefix")}</label>
            <Input
              id="random-prefix"
              className="h-7 w-48 font-mono text-xs"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder={t("option.prefixPlaceholder")}
              dir={autoDir(prefix)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {mode === "custom" && (
            <>
              <div className="pane-options">
                {(Object.keys(CHARACTER_SETS) as CharacterSet[]).map((key) => (
                  <label key={key} className="option-switch" htmlFor={`random-set-${key}`}>
                    {t(`set.${key}`)}
                    <Switch
                      id={`random-set-${key}`}
                      checked={sets[key]}
                      onCheckedChange={(checked) => setSets((current) => ({ ...current, [key]: checked }))}
                      disabled={Boolean(customAlphabet)}
                    />
                  </label>
                ))}
              </div>
              <div className="pane-options">
                <label htmlFor="random-alphabet" className="w-20 font-medium">{t("option.alphabet")}</label>
                <Input
                  id="random-alphabet"
                  className="h-7 min-w-48 flex-1 font-mono text-xs"
                  value={customAlphabet}
                  onChange={(e) => setCustomAlphabet(e.target.value)}
                  placeholder={t("option.alphabetPlaceholder")}
                  dir={autoDir(customAlphabet)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="text-muted-foreground">{t("option.alphabetHint")}</span>
              </div>
            </>
          )}
          <div className="pane-options">
            <span className="w-20 font-medium">{t("option.characters")}</span>
            <code dir="ltr" className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground" data-testid="random-alphabet-preview">
              {byteMode ? `${alphabet.join("")} ${t("chars.encoded")}` : alphabet.join("") || t("chars.none")}
            </code>
          </div>
        </EditorPane>
      }
      second={
        <EditorPane title={t("pane.output")} htmlFor={output ? "random-output" : undefined} scroll={false}
          actions={<CopyButton value={output} label={t("action.copyAll")} />}>
          {output ? (
            <CodeTextarea id="random-output" value={output} readOnly />
          ) : (
            <PaneEmpty title={t("empty.title")} hint={t("empty.hint")} />
          )}
        </EditorPane>
      }
      status={
        error ? (
          <span className="text-destructive">{t("status.noAlphabet")}</span>
        ) : (
          <>
            <span>{t("status.bits", { bits: Math.round(bits) })}</span>
            <span>{t("status.strings", { count })}</span>
            <span>{t("status.alphabet", { n: alphabet.length })}</span>
          </>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
