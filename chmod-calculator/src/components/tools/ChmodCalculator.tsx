import { useMemo, useRef, useState } from "react";
import { FileLock2, Terminal } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/tools/CopyButton";
import { ToolFaqSection, type ToolFaqItem } from "@/components/tools/ToolFaq";
import {
  CLASSES,
  PERMS,
  PRESETS,
  SPECIAL_BITS,
  applyExpression,
  chmodCommands,
  classLabel,
  explainMode,
  formatLs,
  formatOctal,
  formatSymbolic,
  parseModeInput,
  parseSymbolic,
  parseUmask,
  permLabel,
  presetLabel,
  umaskDefaults,
} from "@/utils/chmod";

const FAQ_KEYS = ["octal", "lsLetters", "plusX", "capitalX", "umask"] as const;

/** Text with `code` spans: the odd pieces between backticks are code. Keeps markup out of the dictionaries. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((piece, index) =>
        index % 2 === 1 ? (
          <code key={index} className="font-mono font-medium" dir="ltr">
            {piece}
          </code>
        ) : (
          piece
        ),
      )}
    </>
  );
}

/** Applies a parsed file type to the Directory switch. Types other than file and directory leave it as it is. */
const directoryFor = (fileType: string | undefined, current: boolean) => (fileType === "directory" ? true : fileType === "file" ? false : current);

export function ChmodCalculator() {
  const t = useT();
  const [mode, setMode] = useState(0o755);
  const [isDirectory, setIsDirectory] = useState(false);
  const [octalText, setOctalText] = useState("755");
  const [octalError, setOctalError] = useState<string | null>(null);
  // The mode the Octal field was read as; the sentence is built when it is shown, in the current language.
  const [octalNote, setOctalNote] = useState<number | null>(null);
  const [symbolicText, setSymbolicText] = useState("rwxr-xr-x");
  const [symbolicError, setSymbolicError] = useState<string | null>(null);
  const [expression, setExpression] = useState("");
  const [path, setPath] = useState("file");
  const [recursive, setRecursive] = useState(false);
  const [umaskText, setUmaskText] = useState("022");
  // The mode before the user started to type an expression in the Octal field. Each keystroke applies
  // the expression to this mode, so u+w followed by a backspace does not keep the w.
  const expressionBase = useRef<number | null>(null);

  /** Sets the mode and rewrites every text field except the one the user is typing in. */
  const update = (next: number, source?: "octal" | "symbolic") => {
    setMode(next);
    if (source !== "octal") {
      expressionBase.current = null;
      setOctalText(formatOctal(next));
      setOctalError(null);
      setOctalNote(null);
    }
    if (source !== "symbolic") {
      setSymbolicText(formatSymbolic(next));
      setSymbolicError(null);
    }
  };

  const changeOctal = (text: string) => {
    setOctalText(text);
    const base = expressionBase.current ?? mode;
    const result = parseModeInput(text, base, isDirectory);
    if ("error" in result) {
      // Keep the base through a half-typed expression, such as "a+z" on the way to "a+r".
      setOctalError(result.error);
      setOctalNote(null);
      return;
    }
    setOctalError(null);
    expressionBase.current = result.kind === "expression" ? base : null;
    if (result.path !== undefined) setPath(result.path);
    if (result.recursive !== undefined) setRecursive(result.recursive);
    if (result.fileType) setIsDirectory(directoryFor(result.fileType, isDirectory));
    setOctalNote(result.kind === "octal" && result.path === undefined ? null : result.mode);
    update(result.mode, "octal");
  };

  const changeSymbolic = (text: string) => {
    setSymbolicText(text);
    const result = parseSymbolic(text);
    if ("error" in result) {
      setSymbolicError(result.error);
      return;
    }
    setSymbolicError(null);
    setIsDirectory(directoryFor(result.fileType, isDirectory));
    update(result.mode, "symbolic");
  };

  const toggleBit = (bit: number) => update(mode ^ bit);

  const preview = useMemo(() => (expression.trim() ? applyExpression(mode, expression, isDirectory) : null), [mode, expression, isDirectory]);
  const applyPreview = () => {
    if (preview?.ok) update(preview.mode);
  };

  const commands = chmodCommands(mode, path, recursive);
  const lsText = formatLs(mode, isDirectory);
  const sentences = explainMode(mode, isDirectory);
  const umask = parseUmask(umaskText);
  const defaults = umask.ok ? umaskDefaults(umask.mode) : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileLock2 className="h-5 w-5" />
            {t("permissions.title")}
          </CardTitle>
          <CardDescription>{t("permissions.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="chmod-octal">{t("octal.label")}</Label>
              <Input
                id="chmod-octal"
                type="text"
                aria-invalid={Boolean(octalError)}
                spellCheck={false}
                autoComplete="off"
                placeholder={t("octal.placeholder")}
                dir="ltr"
                value={octalText}
                onChange={(event) => changeOctal(event.target.value)}
                className="font-mono"
              />
              {octalError ? (
                <p className="text-xs text-destructive" role="alert">
                  {octalError}
                </p>
              ) : (
                octalNote !== null && (
                  <p className="text-xs text-muted-foreground" role="status">
                    {t("octal.readAs", { mode: formatOctal(octalNote) })}
                  </p>
                )
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="chmod-symbolic">{t("symbolic.label")}</Label>
              <Input
                id="chmod-symbolic"
                type="text"
                aria-invalid={Boolean(symbolicError)}
                spellCheck={false}
                autoComplete="off"
                placeholder={t("symbolic.placeholder")}
                dir="ltr"
                value={symbolicText}
                onChange={(event) => changeSymbolic(event.target.value)}
                className="font-mono"
              />
              {symbolicError && (
                <p className="text-xs text-destructive" role="alert">
                  {symbolicError}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label={t("presets.aria")}>
            {PRESETS.map((preset) => (
              <Button
                key={preset.mode}
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={mode === preset.mode}
                onClick={() => update(preset.mode)}
              >
                <span className="font-mono font-semibold">{formatOctal(preset.mode)}</span>
                <span className="text-muted-foreground">{presetLabel(preset.id)}</span>
              </Button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-[auto_1fr]">
            <table className="text-sm" aria-label={t("bits.aria")}>
              <thead>
                <tr>
                  <th scope="col" />
                  {PERMS.map((perm) => (
                    <th key={perm.perm} scope="col" className="px-3 pb-2 text-center text-xs font-medium text-muted-foreground">
                      {permLabel(perm.perm)}
                    </th>
                  ))}
                  <th scope="col" className="px-3 pb-2 text-center text-xs font-medium text-muted-foreground">
                    {t("bits.digit")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {CLASSES.map((item) => (
                  <tr key={item.who} className="border-t border-border/50">
                    <th scope="row" className="py-2 pe-4 text-start font-medium">
                      {classLabel(item.who)}
                    </th>
                    {PERMS.map((perm) => {
                      const bit = perm.bit << item.shift;
                      return (
                        <td key={perm.perm} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            aria-label={t("bits.bitAria", { class: classLabel(item.who), perm: permLabel(perm.perm).toLowerCase() })}
                            checked={(mode & bit) !== 0}
                            onChange={() => toggleBit(bit)}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center font-mono">{(mode >> item.shift) & 7}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="space-y-3">
              <h3 className="text-sm font-medium">{t("special.title")}</h3>
              <div className="flex flex-wrap gap-4">
                {SPECIAL_BITS.map((special) => (
                  <label key={special.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={(mode & special.bit) !== 0} onChange={() => toggleBit(special.bit)} />
                    {special.label}
                  </label>
                ))}
              </div>
              <label className="option-switch" htmlFor="chmod-directory">
                {t("directory.label")}
                <Switch id="chmod-directory" checked={isDirectory} onCheckedChange={setIsDirectory} />
              </label>
              <p className="text-xs text-muted-foreground">{t("directory.hint")}</p>
            </div>
          </div>

          <div className="space-y-1" aria-label={t("explain.aria")}>
            {sentences.map((sentence, index) => (
              // The first three sentences cover owner, group, and others. The rest are notes.
              <p key={sentence} className={index < 3 ? "text-base font-medium" : "text-sm text-muted-foreground"}>
                {sentence}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            {t("commands.title")}
          </CardTitle>
          <CardDescription>{t("commands.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-48 flex-1 space-y-2">
              <Label htmlFor="chmod-path">{t("commands.path")}</Label>
              <Input
                id="chmod-path"
                type="text"
                spellCheck={false}
                autoComplete="off"
                placeholder="file"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                className="font-mono"
              />
            </div>
            <label className="option-switch mb-2" htmlFor="chmod-recursive">
              {t("commands.recursive")}
              <Switch id="chmod-recursive" checked={recursive} onCheckedChange={setRecursive} />
            </label>
          </div>
          {[
            { label: t("commands.octal"), value: commands.octal },
            { label: t("commands.symbolic"), value: commands.symbolic },
            { label: "ls -l", value: lsText },
          ].map((row) => (
            <div key={row.label} className="space-y-1">
              <Label className="text-xs text-muted-foreground">{row.label}</Label>
              <div className="flex items-center gap-2">
                <code dir="ltr" className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-sm" aria-label={row.label}>
                  {row.value}
                </code>
                <CopyButton value={row.value} ariaLabel={t("copy.label", { label: row.label })} iconOnly />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("expression.title")}</CardTitle>
          <CardDescription>{t("expression.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              applyPreview();
            }}
          >
            <Input
              type="text"
              aria-label={t("expression.aria")}
              dir="ltr"
              aria-invalid={preview ? !preview.ok : false}
              spellCheck={false}
              autoComplete="off"
              placeholder="u+x"
              value={expression}
              onChange={(event) => setExpression(event.target.value)}
              className="min-w-48 flex-1 font-mono"
            />
            <Button type="submit" disabled={!preview?.ok}>
              {t("expression.apply")}
            </Button>
          </form>
          {preview &&
            (preview.ok ? (
              <p className="text-sm" role="status">
                <Rich
                  text={t("expression.becomes", {
                    from: `${formatOctal(mode)} (${formatSymbolic(mode)})`,
                    to: `\`${formatOctal(preview.mode)} (${formatSymbolic(preview.mode)})\``,
                  })}
                />
              </p>
            ) : (
              <div className="workspace-notice rounded-md" data-tone="error" role="alert">
                {"error" in preview && preview.error}
              </div>
            ))}
          <p className="text-xs text-muted-foreground">{t("expression.note")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>umask</CardTitle>
          <CardDescription>{t("umask.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="text"
            aria-label="umask"
            dir="ltr"
            aria-invalid={!umask.ok}
            spellCheck={false}
            autoComplete="off"
            placeholder="022"
            value={umaskText}
            onChange={(event) => setUmaskText(event.target.value)}
            className="w-32 font-mono"
          />
          {defaults ? (
            <ul className="grid gap-2 sm:grid-cols-2" aria-label={t("umask.defaults")}>
              {[
                { id: "files", label: t("umask.newFiles"), copy: t("umask.copyFiles"), value: defaults.file },
                { id: "directories", label: t("umask.newDirectories"), copy: t("umask.copyDirectories"), value: defaults.directory },
              ].map((row) => (
                <li key={row.id} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
                  <span className="text-xs text-muted-foreground">{row.label}</span>
                  <code dir="ltr" className="ms-auto font-mono text-sm">
                    {formatOctal(row.value)} ({formatSymbolic(row.value)})
                  </code>
                  <CopyButton value={formatOctal(row.value)} ariaLabel={row.copy} iconOnly />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-destructive" role="alert">
              {"error" in umask && umask.error}
            </p>
          )}
        </CardContent>
      </Card>

      <ToolFaqSection items={FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }))} />
    </div>
  );
}
