// Translates date format strings between Go layouts, strftime (C, Python, Ruby), Java/Unicode
// patterns, date-fns, Moment.js/Day.js, PHP date(), and .NET custom formats.
//
// Every dialect parses into the same list of parts (literal text, fields, fractions, and raw
// tokens that only the source dialect knows). Every dialect then emits from that list. When a
// target has no exact token, the emitter uses the closest one and returns a warning for it.

import { t, type TKey, type TVars } from "@/lib/i18n";

export type Dialect = "go" | "c" | "python" | "ruby" | "java" | "datefns" | "moment" | "php" | "dotnet";

export const DIALECTS: { id: Dialect; label: string }[] = [
  { id: "go", label: "Go" },
  { id: "c", label: "C strftime" },
  { id: "python", label: "Python strftime" },
  { id: "ruby", label: "Ruby strftime" },
  { id: "java", label: "Java / Kotlin / Swift" },
  { id: "datefns", label: "date-fns" },
  { id: "moment", label: "Moment.js / Day.js" },
  { id: "php", label: "PHP date()" },
  { id: "dotnet", label: ".NET" },
];

export const DIALECT_LABELS = Object.fromEntries(DIALECTS.map((d) => [d.id, d.label])) as Record<Dialect, string>;

export type FieldId =
  | "year" | "year2" | "isoWeekYear" | "isoWeek" | "quarter"
  | "month" | "month2" | "monthShort" | "monthLong"
  | "day" | "day2" | "daySpace" | "daySuffix"
  | "dayOfYear" | "dayOfYear3" | "dayOfYearSpace" | "dayOfYear0"
  | "weekdayShort" | "weekdayLong" | "weekdayIso" | "weekday0"
  | "hour" | "hour2" | "hourSpace" | "hour12" | "hour12_2" | "hour12Space"
  | "minute" | "minute2" | "second" | "second2"
  | "ampm" | "ampmLower"
  | "offset" | "offsetColon" | "offsetHour" | "offsetZ" | "offsetColonZ" | "offsetHourZ"
  | "zoneAbbr" | "zoneId"
  | "unix" | "unixMs";

/** The dictionary key of each field's description. */
export const FIELD_LABELS: Record<FieldId, TKey> = {
  year: "field.year",
  year2: "field.year2",
  isoWeekYear: "field.isoWeekYear",
  isoWeek: "field.isoWeek",
  quarter: "field.quarter",
  month: "field.month",
  month2: "field.month2",
  monthShort: "field.monthShort",
  monthLong: "field.monthLong",
  day: "field.day",
  day2: "field.day2",
  daySpace: "field.daySpace",
  daySuffix: "field.daySuffix",
  dayOfYear: "field.dayOfYear",
  dayOfYear3: "field.dayOfYear3",
  dayOfYearSpace: "field.dayOfYearSpace",
  dayOfYear0: "field.dayOfYear0",
  weekdayShort: "field.weekdayShort",
  weekdayLong: "field.weekdayLong",
  weekdayIso: "field.weekdayIso",
  weekday0: "field.weekday0",
  hour: "field.hour",
  hour2: "field.hour2",
  hourSpace: "field.hourSpace",
  hour12: "field.hour12",
  hour12_2: "field.hour12_2",
  hour12Space: "field.hour12Space",
  minute: "field.minute",
  minute2: "field.minute2",
  second: "field.second",
  second2: "field.second2",
  ampm: "field.ampm",
  ampmLower: "field.ampmLower",
  offset: "field.offset",
  offsetColon: "field.offsetColon",
  offsetHour: "field.offsetHour",
  offsetZ: "field.offsetZ",
  offsetColonZ: "field.offsetColonZ",
  offsetHourZ: "field.offsetHourZ",
  zoneAbbr: "field.zoneAbbr",
  zoneId: "field.zoneId",
  unix: "field.unix",
  unixMs: "field.unixMs",
};

export type Part =
  | { kind: "literal"; text: string; src?: string }
  | { kind: "field"; field: FieldId; src?: string }
  /** Fractional seconds. `sep` is the "." or "," before the digits. `trim` drops trailing zeros. */
  | { kind: "fraction"; digits: number; trim: boolean; sep: string; src?: string }
  /** A token only the source dialect has, such as the era or a locale's date format. */
  | { kind: "raw"; dialect: Dialect; text: string; /** Already translated. */ label: string; src?: string };

export interface ParseResult {
  parts: Part[];
  warnings: string[];
}

export interface EmitResult {
  format: string;
  warnings: string[];
}

/** One row of the token table: the source text and what it means. */
export const describePart = (part: Part): string => {
  switch (part.kind) {
    case "literal":
      return t("part.literal");
    case "field":
      return t(FIELD_LABELS[part.field]);
    case "fraction":
      return t(part.trim ? "part.fractionTrim" : "part.fraction", { count: part.digits });
    case "raw":
      return part.label;
  }
};

// ---------------------------------------------------------------------------------------------
// Parsing helpers

/** The description of a token only its own dialect knows: a dictionary key, translated when the token is read. */
type RawLabel = { key: TKey; vars?: TVars };
const raw = (key: TKey, vars?: TVars): RawLabel => ({ key, vars });

class PartList {
  parts: Part[] = [];
  warnings: string[] = [];

  literal(text: string, src = text) {
    if (!text && !src) return;
    const last = this.parts[this.parts.length - 1];
    if (last?.kind === "literal") {
      last.text += text;
      last.src = (last.src ?? "") + src;
    } else {
      this.parts.push({ kind: "literal", text, src });
    }
  }

  field(field: FieldId, src: string) {
    this.parts.push({ kind: "field", field, src });
  }

  fraction(digits: number, trim: boolean, src: string, sep = "") {
    this.parts.push({ kind: "fraction", digits, trim, sep, src });
  }

  raw(dialect: Dialect, text: string, label: RawLabel) {
    this.parts.push({ kind: "raw", dialect, text, label: t(label.key, label.vars), src: text });
  }

  warn(message: string) {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  /** Moves a "." or "," right before a fraction into the fraction, so Go can emit `.000`. */
  done(): ParseResult {
    const parts: Part[] = [];
    for (const part of this.parts) {
      const prev = parts[parts.length - 1];
      if (part.kind === "fraction" && !part.sep && prev?.kind === "literal" && /[.,]$/.test(prev.text)) {
        const sep = prev.text.slice(-1);
        prev.text = prev.text.slice(0, -1);
        prev.src = prev.src?.endsWith(sep) ? prev.src.slice(0, -1) : prev.src;
        if (!prev.text) parts.pop();
        parts.push({ ...part, sep, src: `${sep}${part.src ?? ""}` });
      } else {
        parts.push(part);
      }
    }
    return { parts, warnings: this.warnings };
  }
}

const isLetter = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);
const isDigit = (c: string | undefined) => !!c && c >= "0" && c <= "9";

const runLength = (s: string, i: number) => {
  let j = i;
  while (s[j] === s[i]) j++;
  return j - i;
};

// ---------------------------------------------------------------------------------------------
// Go

const GO_PREFIX_TOKENS: [string, FieldId | null, RawLabel?][] = [
  ["January", "monthLong"],
  ["Jan", "monthShort"],
  ["Monday", "weekdayLong"],
  ["Mon", "weekdayShort"],
  ["MST", "zoneAbbr"],
  ["2006", "year"],
  ["002", "dayOfYear3"],
  ["01", "month2"],
  ["02", "day2"],
  ["03", "hour12_2"],
  ["04", "minute2"],
  ["05", "second2"],
  ["06", "year2"],
  ["15", "hour2"],
  ["__2", "dayOfYearSpace"],
  ["_2", "daySpace"],
  ["PM", "ampm"],
  ["pm", "ampmLower"],
  ["-070000", null, raw("raw.offsetSecondsEx", { example: "-070000" })],
  ["-07:00:00", null, raw("raw.offsetSecondsEx", { example: "-07:00:00" })],
  ["-0700", "offset"],
  ["-07:00", "offsetColon"],
  ["-07", "offsetHour"],
  ["Z070000", null, raw("raw.offsetSecondsZEx", { example: "Z070000" })],
  ["Z07:00:00", null, raw("raw.offsetSecondsZEx", { example: "Z07:00:00" })],
  ["Z0700", "offsetZ"],
  ["Z07:00", "offsetColonZ"],
  ["Z07", "offsetHourZ"],
  ["1", "month"],
  ["2", "day"],
  ["3", "hour12"],
  ["4", "minute"],
  ["5", "second"],
];

// Mirrors nextStdChunk in Go's time/format.go, including its order of checks.
function parseGo(layout: string): ParseResult {
  const out = new PartList();
  let i = 0;
  while (i < layout.length) {
    const c = layout[i];
    // "_2006" is a literal "_" and then the year.
    if (c === "_" && layout.startsWith("_2006", i)) {
      out.literal("_");
      i++;
      continue;
    }
    // "002" wins only when "0" is not followed by 1 to 6.
    if (c === "0" && layout[i + 1] >= "1" && layout[i + 1] <= "6") {
      const token = layout.slice(i, i + 2);
      out.field(GO_PREFIX_TOKENS.find(([t]) => t === token)![1]!, token);
      i += 2;
      continue;
    }
    if ((c === "." || c === ",") && (layout[i + 1] === "0" || layout[i + 1] === "9")) {
      const n = runLength(layout, i + 1);
      if (!isDigit(layout[i + 1 + n])) {
        const src = layout.slice(i, i + 1 + n);
        if (n > 9) out.warn(t("warn.goFractionDigits", { src }));
        out.fraction(Math.min(n, 9), layout[i + 1] === "9", src, c);
        i += 1 + n;
        continue;
      }
    }
    const match = GO_PREFIX_TOKENS.find(([token]) => layout.startsWith(token, i));
    if (match) {
      const [token, field, label] = match;
      if (field) out.field(field, token);
      else out.raw("go", token, label!);
      i += token.length;
      continue;
    }
    out.literal(c);
    i++;
  }
  return out.done();
}

// ---------------------------------------------------------------------------------------------
// strftime (C, Python, and Ruby share one parser; the emitters differ)

const STRFTIME_FIELDS: Record<string, { field: FieldId; minus?: FieldId; under?: FieldId; zero?: FieldId }> = {
  Y: { field: "year" },
  y: { field: "year2" },
  G: { field: "isoWeekYear" },
  V: { field: "isoWeek" },
  m: { field: "month2", minus: "month" },
  b: { field: "monthShort" },
  h: { field: "monthShort" },
  B: { field: "monthLong" },
  d: { field: "day2", minus: "day", under: "daySpace" },
  e: { field: "daySpace", minus: "day", zero: "day2" },
  j: { field: "dayOfYear3", minus: "dayOfYear", under: "dayOfYearSpace" },
  a: { field: "weekdayShort" },
  A: { field: "weekdayLong" },
  u: { field: "weekdayIso" },
  w: { field: "weekday0" },
  H: { field: "hour2", minus: "hour", under: "hourSpace" },
  k: { field: "hourSpace", minus: "hour", zero: "hour2" },
  I: { field: "hour12_2", minus: "hour12", under: "hour12Space" },
  l: { field: "hour12Space", minus: "hour12", zero: "hour12_2" },
  M: { field: "minute2", minus: "minute" },
  S: { field: "second2", minus: "second" },
  p: { field: "ampm" },
  P: { field: "ampmLower" },
  z: { field: "offset" },
  Z: { field: "zoneAbbr" },
  s: { field: "unix" },
  Q: { field: "unixMs" },
};

const STRFTIME_COMPOSITES: Record<string, string> = {
  F: "%Y-%m-%d",
  T: "%H:%M:%S",
  R: "%H:%M",
  D: "%m/%d/%y",
  r: "%I:%M:%S %p",
};

const STRFTIME_RAW: Record<string, RawLabel> = {
  c: raw("raw.localeDateTime"),
  x: raw("raw.localeDate"),
  X: raw("raw.localeTime"),
  C: raw("raw.century"),
  g: raw("raw.isoWeekYear2"),
  U: raw("raw.weekSundayFirst"),
  W: raw("raw.weekMondayFirst"),
  "+": raw("raw.dateCommand"),
  v: raw("raw.rubyDate"),
};

function parseStrftime(format: string, dialect: Dialect): ParseResult {
  const out = new PartList();
  let i = 0;
  while (i < format.length) {
    const c = format[i];
    if (c !== "%") {
      out.literal(c);
      i++;
      continue;
    }
    const m = /^%([-_0^#]*)(\d*)(:{0,3})(.?)/s.exec(format.slice(i))!;
    const [src, flags, width, colons, conv] = m;
    i += src.length;
    if (!conv) {
      out.warn(t("warn.loneSign"));
      out.literal("%", src);
      continue;
    }
    if (flags.includes("^") || flags.includes("#")) {
      out.warn(t("warn.caseFlag", { flag: flags.includes("^") ? "^" : "#", src }));
    }
    if (conv === "%") {
      out.literal("%", src);
    } else if (conv === "n" || conv === "t") {
      out.literal(conv === "n" ? "\n" : "\t", src);
    } else if (conv === "z") {
      if (colons === "") out.field("offset", src);
      else if (colons === ":") out.field("offsetColon", src);
      else out.raw(dialect, src, raw("raw.offsetSecondsEx", { example: "-07:00:00" }));
    } else if (conv === "f") {
      out.fraction(6, false, src);
    } else if (conv === "L") {
      out.fraction(width ? Number(width) : 3, false, src);
    } else if (conv === "N") {
      out.fraction(width ? Number(width) : 9, false, src);
    } else if (STRFTIME_COMPOSITES[conv]) {
      const inner = parseStrftime(STRFTIME_COMPOSITES[conv], dialect).parts;
      for (const part of inner) {
        if (part.kind === "literal") out.literal(part.text);
        else out.parts.push(part);
      }
    } else if (STRFTIME_FIELDS[conv]) {
      const entry = STRFTIME_FIELDS[conv];
      let field = entry.field;
      if (flags.includes("-") && entry.minus) field = entry.minus;
      else if (flags.includes("_") && entry.under) field = entry.under;
      else if (flags.includes("0") && entry.zero) field = entry.zero;
      else if (/[-_0]/.test(flags)) out.warn(t("warn.paddingFlag", { src }));
      if (width) out.warn(t("warn.widthIgnored", { src }));
      out.field(field, src);
    } else if (STRFTIME_RAW[conv]) {
      out.raw(dialect, src, STRFTIME_RAW[conv]);
    } else {
      out.warn(t("warn.unknownDirective", { src }));
      out.literal(src);
    }
  }
  return out.done();
}

// ---------------------------------------------------------------------------------------------
// Java DateTimeFormatter and date-fns: Unicode-style letters, quoted text in '...'

type LetterRule = (count: number) => FieldId | { fraction: number } | { raw: RawLabel } | null;
/** A letter rule result that is a raw token with this description. */
const rawOf = (key: TKey, vars?: TVars) => ({ raw: raw(key, vars) });

const nameOrNumber = (count: number, num: FieldId, num2: FieldId) => (count === 1 ? num : count === 2 ? num2 : null);
const monthRule: LetterRule = (n) => (n === 1 ? "month" : n === 2 ? "month2" : n === 3 ? "monthShort" : n === 4 ? "monthLong" : rawOf("raw.monthNarrow"));
const textWeekday: LetterRule = (n) => (n <= 3 ? "weekdayShort" : n === 4 ? "weekdayLong" : rawOf("raw.weekdayNarrow"));

const JAVA_LETTERS: Record<string, LetterRule> = {
  G: () => (rawOf("raw.era")),
  u: (n) => (n === 2 ? "year2" : "year"),
  y: (n) => (n === 2 ? "year2" : "year"),
  Y: (n) => (n === 2 ? rawOf("raw.weekBasedYear2") : "isoWeekYear"),
  Q: (n) => (n === 1 ? "quarter" : rawOf(n === 2 ? "raw.quarter2" : "raw.quarterText")),
  q: (n) => (n === 1 ? "quarter" : rawOf(n === 2 ? "raw.quarter2" : "raw.quarterText")),
  M: monthRule,
  L: monthRule,
  w: (n) => (n <= 2 ? "isoWeek" : null),
  W: () => (rawOf("raw.weekOfMonth")),
  E: textWeekday,
  e: (n) => (n <= 2 ? "weekdayIso" : textWeekday(n - 1)),
  c: (n) => (n === 1 ? "weekdayIso" : textWeekday(n - 1)),
  F: () => (rawOf("raw.alignedWeekOfMonth")),
  d: (n) => nameOrNumber(n, "day", "day2"),
  D: (n) => (n === 1 ? "dayOfYear" : n === 3 ? "dayOfYear3" : n === 2 ? rawOf("raw.dayOfYear2") : null),
  a: (n) => (n === 1 ? "ampm" : null),
  B: () => (rawOf("raw.dayPeriod")),
  h: (n) => nameOrNumber(n, "hour12", "hour12_2"),
  K: (n) => (n <= 2 ? rawOf("raw.hour12From0") : null),
  k: (n) => (n <= 2 ? rawOf("raw.hour24From1") : null),
  H: (n) => nameOrNumber(n, "hour", "hour2"),
  m: (n) => nameOrNumber(n, "minute", "minute2"),
  s: (n) => nameOrNumber(n, "second", "second2"),
  S: (n) => (n <= 9 ? { fraction: n } : null),
  A: () => (rawOf("raw.msOfDay")),
  n: () => (rawOf("raw.nanoOfSecond")),
  N: () => (rawOf("raw.nanoOfDay")),
  V: (n) => (n === 2 ? "zoneId" : null),
  v: () => (rawOf("raw.zoneGeneric")),
  z: (n) => (n <= 3 ? "zoneAbbr" : n === 4 ? rawOf("raw.zoneName") : null),
  O: () => (rawOf("raw.offsetLocalizedShort")),
  X: (n) => (n === 1 ? "offsetHourZ" : n === 2 ? "offsetZ" : n === 3 ? "offsetColonZ" : n <= 5 ? rawOf("raw.offsetSecondsZ") : null),
  x: (n) => (n === 1 ? "offsetHour" : n === 2 ? "offset" : n === 3 ? "offsetColon" : n <= 5 ? rawOf("raw.offsetSeconds") : null),
  Z: (n) => (n <= 3 ? "offset" : n === 4 ? rawOf("raw.offsetLocalizedLong") : n === 5 ? "offsetColonZ" : null),
};

const DATEFNS_LETTERS: Record<string, LetterRule> = {
  G: () => (rawOf("raw.era")),
  y: (n) => (n === 2 ? "year2" : "year"),
  Y: () => (rawOf("raw.localWeekYear")),
  R: (n) => (n === 2 ? rawOf("raw.isoWeekYear2") : "isoWeekYear"),
  u: () => (rawOf("raw.extendedYear")),
  Q: (n) => (n === 1 ? "quarter" : rawOf(n === 2 ? "raw.quarter2" : "raw.quarterText")),
  q: (n) => (n === 1 ? "quarter" : rawOf(n === 2 ? "raw.quarter2" : "raw.quarterText")),
  M: monthRule,
  L: monthRule,
  w: () => (rawOf("raw.localWeek")),
  I: (n) => (n <= 2 ? "isoWeek" : null),
  d: (n) => nameOrNumber(n, "day", "day2"),
  D: (n) => (n === 1 ? "dayOfYear" : n === 3 ? "dayOfYear3" : n === 2 ? rawOf("raw.dayOfYear2") : null),
  E: textWeekday,
  i: (n) => (n === 1 ? "weekdayIso" : n === 2 ? rawOf("raw.isoWeekday2") : textWeekday(n - 1)),
  e: (n) => (n <= 2 ? rawOf("raw.localWeekday") : textWeekday(n - 1)),
  c: (n) => (n <= 2 ? rawOf("raw.localWeekday") : textWeekday(n - 1)),
  a: (n) => (n <= 2 ? "ampm" : n === 3 ? "ampmLower" : rawOf("raw.ampmLong")),
  b: () => (rawOf("raw.ampmNoon")),
  B: () => (rawOf("raw.dayPeriod")),
  h: (n) => nameOrNumber(n, "hour12", "hour12_2"),
  K: (n) => (n <= 2 ? rawOf("raw.hour12From0") : null),
  k: (n) => (n <= 2 ? rawOf("raw.hour24From1") : null),
  H: (n) => nameOrNumber(n, "hour", "hour2"),
  m: (n) => nameOrNumber(n, "minute", "minute2"),
  s: (n) => nameOrNumber(n, "second", "second2"),
  S: (n) => ({ fraction: n }),
  X: (n) => (n === 1 ? "offsetHourZ" : n === 2 ? "offsetZ" : n === 3 ? "offsetColonZ" : rawOf("raw.offsetSecondsZ")),
  x: (n) => (n === 1 ? "offsetHour" : n === 2 ? "offset" : n === 3 ? "offsetColon" : rawOf("raw.offsetSeconds")),
  O: () => (rawOf("raw.offsetLocalizedShort")),
  z: (n) => (n <= 3 ? "zoneAbbr" : rawOf("raw.offsetLocalizedLong")),
  t: () => "unix",
  T: () => "unixMs",
  P: () => (rawOf("raw.localeDate")),
  p: () => (rawOf("raw.localeTime")),
};

// Letters that accept an "o" suffix in date-fns: 1st, 2nd, and so on.
const DATEFNS_ORDINAL = new Set(["y", "R", "Q", "q", "M", "L", "w", "I", "d", "D", "i", "e", "c", "h", "H", "K", "k", "m", "s"]);

function parseUnicode(format: string, dialect: "java" | "datefns"): ParseResult {
  const out = new PartList();
  const name = DIALECT_LABELS[dialect];
  const letters = dialect === "java" ? JAVA_LETTERS : DATEFNS_LETTERS;
  let i = 0;
  while (i < format.length) {
    const c = format[i];
    if (c === "'") {
      if (format[i + 1] === "'") {
        out.literal("'", "''");
        i += 2;
        continue;
      }
      let j = i + 1;
      let text = "";
      while (j < format.length) {
        if (format[j] === "'") {
          if (format[j + 1] === "'") {
            text += "'";
            j += 2;
            continue;
          }
          break;
        }
        text += format[j++];
      }
      if (j >= format.length) out.warn(t("warn.quoteNotClosed"));
      out.literal(text, format.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (dialect === "java" && (c === "[" || c === "]")) {
      out.warn(t("warn.javaBrackets"));
      out.literal("", c);
      i++;
      continue;
    }
    if (dialect === "java" && (c === "{" || c === "}" || c === "#")) {
      out.warn(t("warn.javaReserved", { char: c }));
      out.literal(c);
      i++;
      continue;
    }
    if (!isLetter(c)) {
      out.literal(c);
      i++;
      continue;
    }
    // Java pad modifier: "ppd" is the day padded with spaces to width 2.
    if (dialect === "java" && c === "p") {
      const pads = runLength(format, i);
      const letter = format[i + pads];
      const n = isLetter(letter) ? runLength(format, i + pads) : 0;
      const src = format.slice(i, i + pads + n);
      const padded: Record<string, FieldId> = { d: "day", H: "hour", h: "hour12", D: "dayOfYear" };
      const spaced: Record<string, FieldId> = { d: "daySpace", H: "hourSpace", h: "hour12Space", D: "dayOfYearSpace" };
      const width = letter === "D" ? 3 : 2;
      if (n === 1 && padded[letter] && pads === width) out.field(spaced[letter], src);
      else out.raw("java", src, raw("raw.padded"));
      i += pads + n;
      continue;
    }
    const n = runLength(format, i);
    let src = format.slice(i, i + n);
    i += n;
    if (dialect === "datefns" && format[i] === "o" && DATEFNS_ORDINAL.has(c) && n === 1) {
      src += "o";
      i++;
      if (c === "d") {
        out.field("day", src);
        out.field("daySuffix", "");
      } else {
        out.raw("datefns", src, raw("raw.ordinal"));
      }
      continue;
    }
    const rule = letters[c] as (typeof letters)[string] | undefined; // a letter without a rule is undefined at run time
    const result = rule ? rule(n) : null;
    if (dialect === "datefns" && (src === "YY" || src === "YYYY")) out.warn(t("warn.datefnsWeekYear", { src, suggest: src.toLowerCase() }));
    if (dialect === "datefns" && (src === "D" || src === "DD")) out.warn(t("warn.datefnsDayOfYearParse", { src, suggest: src.toLowerCase() }));
    if (result === null) {
      out.warn(
        rule
          ? t("warn.tooManyLetters", { name, src })
          : dialect === "java"
            ? t("warn.javaUnquoted", { char: c, src })
            : t("warn.datefnsUnquoted", { char: c, src }),
      );
      out.literal(src);
    } else if (typeof result === "string") {
      out.field(result, src);
    } else if ("fraction" in result) {
      out.fraction(result.fraction, false, src);
    } else {
      out.raw(dialect, src, result.raw);
    }
  }
  return out.done();
}

// ---------------------------------------------------------------------------------------------
// Moment.js and Day.js: tokens as in moment's formattingTokens, text in [...]

const MOMENT_TOKENS: [string, FieldId | { raw: RawLabel } | { fraction: number } | "Do"][] = [
  ["YYYYYY", rawOf("raw.year6")],
  ["YYYY", "year"],
  ["YY", "year2"],
  ["GGGG", "isoWeekYear"],
  ["GG", rawOf("raw.isoWeekYear2")],
  ["gggg", rawOf("raw.localWeekYear")],
  ["gg", rawOf("raw.localWeekYear2")],
  ["MMMM", "monthLong"],
  ["MMM", "monthShort"],
  ["MM", "month2"],
  ["Mo", rawOf("raw.monthOrdinal")],
  ["M", "month"],
  ["Qo", rawOf("raw.quarterOrdinal")],
  ["Q", "quarter"],
  ["DDDDo", rawOf("raw.dayOfYearOrdinal")],
  ["DDDD", "dayOfYear3"],
  ["DDDo", rawOf("raw.dayOfYearOrdinal")],
  ["DDD", "dayOfYear"],
  ["Do", "Do"],
  ["DD", "day2"],
  ["D", "day"],
  ["dddd", "weekdayLong"],
  ["ddd", "weekdayShort"],
  ["dd", rawOf("raw.weekday2Letters")],
  ["do", rawOf("raw.weekdayOrdinal")],
  ["d", "weekday0"],
  ["E", "weekdayIso"],
  ["e", rawOf("raw.localWeekday")],
  ["WW", "isoWeek"],
  ["Wo", rawOf("raw.isoWeekOrdinal")],
  ["W", "isoWeek"],
  ["ww", rawOf("raw.localWeek")],
  ["wo", rawOf("raw.localWeekOrdinal")],
  ["w", rawOf("raw.localWeek")],
  ["HH", "hour2"],
  ["H", "hour"],
  ["hh", "hour12_2"],
  ["h", "hour12"],
  ["kk", rawOf("raw.hour24From1_2")],
  ["k", rawOf("raw.hour24From1")],
  ["mm", "minute2"],
  ["m", "minute"],
  ["ss", "second2"],
  ["s", "second"],
  ["A", "ampm"],
  ["a", "ampmLower"],
  ["ZZ", "offset"],
  ["Z", "offsetColon"],
  ["zz", "zoneAbbr"],
  ["z", "zoneAbbr"],
  ["X", "unix"],
  ["x", "unixMs"],
  ["N", rawOf("raw.era")],
  ["y", rawOf("raw.eraYear")],
];

function parseMoment(format: string): ParseResult {
  const out = new PartList();
  let i = 0;
  while (i < format.length) {
    const c = format[i];
    if (c === "[") {
      const end = format.indexOf("]", i + 1);
      const nextOpen = format.indexOf("[", i + 1);
      if (end > i && (nextOpen === -1 || nextOpen > end)) {
        out.literal(format.slice(i + 1, end), format.slice(i, end + 1));
        i = end + 1;
        continue;
      }
    }
    if (c === "\\" && i + 1 < format.length) {
      out.literal(format[i + 1], format.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (c === "S") {
      const n = Math.min(runLength(format, i), 9);
      out.fraction(n, false, format.slice(i, i + n));
      i += n;
      continue;
    }
    const match = MOMENT_TOKENS.find(([token]) => format.startsWith(token, i));
    if (!match) {
      out.literal(c);
      i++;
      continue;
    }
    const [token, meaning] = match;
    i += token.length;
    if (meaning === "Do") {
      out.field("day", token);
      out.field("daySuffix", "");
    } else if (typeof meaning === "string") {
      out.field(meaning, token);
    } else if ("raw" in meaning) {
      out.raw("moment", token, meaning.raw);
    } else {
      out.fraction(meaning.fraction, false, token);
    }
  }
  return out.done();
}

// ---------------------------------------------------------------------------------------------
// PHP date(): one letter per token, backslash escapes

const PHP_FIELDS: Record<string, FieldId> = {
  d: "day2", D: "weekdayShort", j: "day", l: "weekdayLong", N: "weekdayIso", S: "daySuffix", w: "weekday0", z: "dayOfYear0",
  W: "isoWeek", F: "monthLong", m: "month2", M: "monthShort", n: "month", o: "isoWeekYear", Y: "year", y: "year2",
  a: "ampmLower", A: "ampm", g: "hour12", G: "hour", h: "hour12_2", H: "hour2", i: "minute2", s: "second2",
  e: "zoneId", O: "offset", P: "offsetColon", p: "offsetColonZ", T: "zoneAbbr", U: "unix",
};

const PHP_RAW: Record<string, RawLabel> = {
  t: raw("raw.daysInMonth"),
  L: raw("raw.leapYear"),
  X: raw("raw.yearSigned"),
  x: raw("raw.yearSignedWhenNeeded"),
  B: raw("raw.swatch"),
  I: raw("raw.dst"),
  Z: raw("raw.offsetInSeconds"),
};

const PHP_COMPOSITES: Record<string, string> = { c: "Y-m-d\\TH:i:sP", r: "D, d M Y H:i:s O" };

function parsePhp(format: string): ParseResult {
  const out = new PartList();
  let i = 0;
  while (i < format.length) {
    const c = format[i];
    if (c === "\\") {
      if (i + 1 < format.length) out.literal(format[i + 1], format.slice(i, i + 2));
      else out.literal("\\");
      i += 2;
      continue;
    }
    i++;
    if (PHP_FIELDS[c]) out.field(PHP_FIELDS[c], c);
    else if (c === "u") out.fraction(6, false, c);
    else if (c === "v") out.fraction(3, false, c);
    else if (PHP_RAW[c]) out.raw("php", c, PHP_RAW[c]);
    else if (PHP_COMPOSITES[c]) {
      for (const part of parsePhp(PHP_COMPOSITES[c]).parts) {
        if (part.kind === "literal") out.literal(part.text);
        else out.parts.push({ ...part, src: part.src });
      }
    } else out.literal(c);
  }
  return out.done();
}

// ---------------------------------------------------------------------------------------------
// .NET custom date and time format strings

function parseDotnet(format: string, whole = true): ParseResult {
  const out = new PartList();
  if (whole && format.length === 1 && isLetter(format)) {
    out.warn(t("warn.dotnetStandard", { format }));
    out.raw("dotnet", format, raw("raw.dotnetStandard"));
    return out.done();
  }
  let i = 0;
  while (i < format.length) {
    const c = format[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      let text = "";
      while (j < format.length && format[j] !== c) {
        if (format[j] === "\\" && j + 1 < format.length) j++;
        text += format[j++];
      }
      if (j >= format.length) out.warn(t("warn.quoteNotClosed"));
      out.literal(text, format.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === "\\") {
      if (i + 1 < format.length) out.literal(format[i + 1], format.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (c === "%") {
      out.literal("", "%");
      i++;
      continue;
    }
    if (!"dfFghHKmMstyz".includes(c)) {
      out.literal(c);
      i++;
      continue;
    }
    const n = runLength(format, i);
    const src = format.slice(i, i + n);
    i += n;
    const pick = (...fields: (FieldId | null)[]) => fields[Math.min(n, fields.length) - 1];
    let field: FieldId | null = null;
    switch (c) {
      case "d": field = pick("day", "day2", "weekdayShort", "weekdayLong"); break;
      case "M": field = pick("month", "month2", "monthShort", "monthLong"); break;
      case "y": field = n === 1 ? null : n === 2 ? "year2" : "year"; break;
      case "h": field = pick("hour12", "hour12_2"); break;
      case "H": field = pick("hour", "hour2"); break;
      case "m": field = pick("minute", "minute2"); break;
      case "s": field = pick("second", "second2"); break;
      case "t": field = n === 1 ? null : "ampm"; break;
      case "z": field = n === 1 ? null : n === 2 ? "offsetHour" : "offsetColon"; break;
      case "K": field = "offsetColonZ"; break;
      case "f":
      case "F":
        if (n > 7) out.warn(t("warn.dotnetFraction7"));
        out.fraction(Math.min(n, 7), c === "F", src);
        continue;
    }
    if (field) out.field(field, src);
    else if (c === "y") out.raw("dotnet", src, raw("raw.year2NoPad"));
    else if (c === "t") out.raw("dotnet", src, raw("raw.ampmFirstLetter"));
    else if (c === "z") out.raw("dotnet", src, raw("raw.offsetHourNoPad"));
    else out.raw("dotnet", src, raw("raw.eraDotnet"));
  }
  return out.done();
}

// ---------------------------------------------------------------------------------------------
// Public parsing entry points

export function parseFormat(format: string, dialect: Dialect): ParseResult {
  switch (dialect) {
    case "go":
      return parseGo(format);
    case "c":
    case "python":
    case "ruby":
      return parseStrftime(format, dialect);
    case "java":
    case "datefns":
      return parseUnicode(format, dialect);
    case "moment":
      return parseMoment(format);
    case "php":
      return parsePhp(format);
    case "dotnet":
      return parseDotnet(format);
  }
}

const unquoted = (format: string, open: string, close: string) => {
  let result = "";
  let depth = false;
  for (const c of format) {
    if (!depth && c === open) depth = true;
    else if (depth && c === close) depth = false;
    else if (!depth) result += c;
  }
  return result;
};

/** Guesses the dialect of a format string. Falls back to Java, the most common Unicode style. */
export function detectDialect(format: string): Dialect {
  if (/%[-_0^#]*\d*:{0,3}[A-Za-z+]/.test(format)) {
    if (/%\d*[LNQ]/.test(format)) return "ruby";
    if (/%f/.test(format)) return "python";
    return "c";
  }
  const quotedSingle = unquoted(format, "'", "'");
  const plain = unquoted(quotedSingle, '"', '"');
  const bare = unquoted(format, "[", "]");
  if (/[yYdDHhMms]/.test(bare) === false || /2006|15:04|:04|04:05|Z07|-07:?00|January|Monday|\bJan\b|\bMon\b|MST|01\/02|\b_2\b|\.000|\.999/.test(format)) {
    if (!/[yY]{2}|[dD]{2}|HH|mm|ss/.test(plain) && /\d|January|Jan|Monday|Mon|MST|PM|pm/.test(format)) return "go";
  }
  if (/\\[A-Za-z]/.test(format) && !/[yd]{2}/.test(plain)) return "php";
  if (/\[[^\]]*\]/.test(format) && /YY|DD|HH|mm/.test(bare)) return "moment";
  if (/YYYY|YY/.test(plain) && /DD|\bD\b|Do/.test(plain)) return "moment";
  if (/\bDo\b|\bA\b/.test(plain) && /YY|MM|DD/.test(plain)) return "moment";
  // PHP: letters never repeat, and at least one PHP-only letter appears.
  const phpLetters = format.replace(/\\./g, "");
  if (!/['[]/.test(format) && !/([A-Za-z])\1/.test(phpLetters) &&/[YijnGgFlNUocr]/.test(phpLetters) && /[A-Za-z]/.test(phpLetters)) return "php";
  if (/f|F|tt|K/.test(plain) || /"/.test(format)) return "dotnet";
  if (/\bdo\b|aaa|RRRR|II|\bi\b/.test(quotedSingle)) return "datefns";
  return "java";
}

// ---------------------------------------------------------------------------------------------
// Emitting

/** A token table entry: the closest token, and a warning when it is not exact. */
type Mapping = string | { t: string | null; w: () => string };

/** A warning of a mapping, translated when it is emitted, not when the module loads. */
const msg = (key: TKey, vars?: TVars) => () => t(key, vars);
const nounKey = (what: TKey) => t(what);

const goNoToken = (what: TKey, code: string): Mapping => ({ t: null, w: () => t("warn.goNoToken", { what: nounKey(what), code }) });

const GO_MAP: Record<FieldId, Mapping> = {
  year: "2006", year2: "06",
  isoWeekYear: goNoToken("noun.isoWeekYear", "t.ISOWeek()"),
  isoWeek: goNoToken("noun.isoWeek", "t.ISOWeek()"),
  quarter: goNoToken("noun.quarter", "(t.Month()+2)/3"),
  month: "1", month2: "01", monthShort: "Jan", monthLong: "January",
  day: "2", day2: "02", daySpace: "_2",
  daySuffix: goNoToken("noun.ordinalSuffix", "a helper function"),
  dayOfYear: { t: "002", w: msg("warn.goDayOfYear") },
  dayOfYear3: { t: "002", w: msg("warn.goDayOfYear3") },
  dayOfYearSpace: { t: "__2", w: msg("warn.goDayOfYearSpace") },
  dayOfYear0: { t: "002", w: msg("warn.goDayOfYear0") },
  weekdayShort: "Mon", weekdayLong: "Monday",
  weekdayIso: goNoToken("noun.weekdayNumber", "int(t.Weekday())"),
  weekday0: goNoToken("noun.weekdayNumber", "int(t.Weekday())"),
  hour: { t: "15", w: msg("warn.goHour") },
  hour2: "15",
  hourSpace: { t: "15", w: msg("warn.goHourSpace") },
  hour12: "3", hour12_2: "03",
  hour12Space: { t: "3", w: msg("warn.goHour12Space") },
  minute: "4", minute2: "04", second: "5", second2: "05",
  ampm: "PM", ampmLower: "pm",
  offset: "-0700", offsetColon: "-07:00", offsetHour: "-07",
  offsetZ: "Z0700", offsetColonZ: "Z07:00", offsetHourZ: "Z07",
  zoneAbbr: "MST",
  zoneId: goNoToken("noun.zoneId", "t.Location().String()"),
  unix: goNoToken("noun.unixTime", "t.Unix()"),
  unixMs: goNoToken("noun.unixTime", "t.UnixMilli()"),
};

/** Notes for strftime extensions that are not in C99, per dialect. */
const strftimeExtension = (dialect: "c" | "python" | "ruby", token: string): Mapping => {
  if (dialect === "ruby") return token;
  if (dialect === "python") return { t: token, w: msg("warn.strftimePython", { token }) };
  return { t: token, w: msg("warn.strftimeExt", { token }) };
};

function strftimeMap(dialect: "c" | "python" | "ruby"): Record<FieldId, Mapping> {
  const ext = (token: string) => strftimeExtension(dialect, token);
  const noToken = (what: TKey): Mapping => ({ t: null, w: () => t("warn.strftimeNoToken", { what: nounKey(what) }) });
  const offsetColon: Mapping =
    dialect === "ruby" ? "%:z"
    : dialect === "python" ? { t: "%:z", w: msg("warn.pythonColonOffset") }
    : { t: "%z", w: msg("warn.cNoColonOffset") };
  const colonToken = typeof offsetColon === "string" ? offsetColon : offsetColon.t!;
  const zWarning = (token: string) => () => t("warn.strftimeZ", { token });
  return {
    year: "%Y", year2: "%y", isoWeekYear: "%G", isoWeek: "%V", quarter: noToken("noun.quarter"),
    month: ext("%-m"), month2: "%m", monthShort: "%b", monthLong: "%B",
    day: ext("%-d"), day2: "%d", daySpace: "%e", daySuffix: noToken("noun.ordinalSuffix"),
    dayOfYear: ext("%-j"), dayOfYear3: "%j", dayOfYearSpace: ext("%_j"),
    dayOfYear0: { t: "%j", w: msg("warn.strftimeDayOfYear0") },
    weekdayShort: "%a", weekdayLong: "%A", weekdayIso: "%u", weekday0: "%w",
    hour: ext("%-H"), hour2: "%H", hourSpace: ext("%k"), hour12: ext("%-I"), hour12_2: "%I", hour12Space: ext("%l"),
    minute: ext("%-M"), minute2: "%M", second: ext("%-S"), second2: "%S",
    ampm: "%p",
    ampmLower: dialect === "ruby" ? "%P" : { t: "%P", w: msg("warn.strftimeLowerP") },
    offset: "%z",
    offsetColon,
    offsetHour: { t: "%z", w: msg("warn.strftimeOffsetHour") },
    offsetZ: { t: "%z", w: zWarning("%z") },
    offsetColonZ: {
      t: colonToken,
      w: typeof offsetColon === "string" ? zWarning(colonToken) : () => t("warn.join", { first: offsetColon.w(), second: zWarning(colonToken)() }),
    },
    offsetHourZ: { t: "%z", w: zWarning("%z") },
    zoneAbbr: "%Z",
    zoneId: { t: "%Z", w: msg("warn.strftimeZoneId") },
    unix: ext("%s"),
    unixMs: dialect === "ruby" ? "%Q" : { t: "%s", w: msg("warn.strftimeUnixMs") },
  };
}

const JAVA_WEEK_NOTE = msg("warn.javaWeek");
const JAVA_PAD_NOTE = msg("warn.javaPad");

const JAVA_MAP: Record<FieldId, Mapping> = {
  year: "yyyy", year2: "yy",
  isoWeekYear: { t: "YYYY", w: JAVA_WEEK_NOTE }, isoWeek: { t: "ww", w: JAVA_WEEK_NOTE },
  quarter: "Q",
  month: "M", month2: "MM", monthShort: "MMM", monthLong: "MMMM",
  day: "d", day2: "dd", daySpace: { t: "ppd", w: JAVA_PAD_NOTE },
  daySuffix: { t: null, w: msg("warn.javaNoOrdinal") },
  dayOfYear: "D", dayOfYear3: "DDD", dayOfYearSpace: { t: "pppD", w: JAVA_PAD_NOTE },
  dayOfYear0: { t: "D", w: msg("warn.javaDayOfYear0") },
  weekdayShort: "EEE", weekdayLong: "EEEE",
  weekdayIso: { t: "e", w: msg("warn.javaWeekdayIso") },
  weekday0: { t: "e", w: msg("warn.javaWeekday0") },
  hour: "H", hour2: "HH", hourSpace: { t: "ppH", w: JAVA_PAD_NOTE },
  hour12: "h", hour12_2: "hh", hour12Space: { t: "pph", w: JAVA_PAD_NOTE },
  minute: "m", minute2: "mm", second: "s", second2: "ss",
  ampm: "a", ampmLower: { t: "a", w: msg("warn.javaAmpmLower") },
  offset: "xx", offsetColon: "xxx", offsetHour: "x", offsetZ: "XX", offsetColonZ: "XXX", offsetHourZ: "X",
  zoneAbbr: "z", zoneId: "VV",
  unix: { t: null, w: msg("warn.javaNoUnix") },
  unixMs: { t: null, w: msg("warn.javaNoUnixMs") },
};

const DATEFNS_MAP: Record<FieldId, Mapping> = {
  year: "yyyy", year2: "yy", isoWeekYear: "RRRR", isoWeek: "II", quarter: "Q",
  month: "M", month2: "MM", monthShort: "MMM", monthLong: "MMMM",
  day: "d", day2: "dd", daySpace: { t: "d", w: msg("warn.datefnsDaySpace") },
  daySuffix: { t: null, w: msg("warn.datefnsNoOrdinal") },
  dayOfYear: { t: "D", w: msg("warn.datefnsDayOfYear") },
  dayOfYear3: "DDD",
  dayOfYearSpace: { t: "DDD", w: msg("warn.datefnsDayOfYearSpace") },
  dayOfYear0: { t: "DDD", w: msg("warn.datefnsDayOfYear0") },
  weekdayShort: "EEE", weekdayLong: "EEEE", weekdayIso: "i",
  weekday0: { t: "i", w: msg("warn.datefnsWeekday0") },
  hour: "H", hour2: "HH", hourSpace: { t: "H", w: msg("warn.datefnsHourSpace") },
  hour12: "h", hour12_2: "hh", hour12Space: { t: "h", w: msg("warn.datefnsHour12Space") },
  minute: "m", minute2: "mm", second: "s", second2: "ss",
  ampm: "a", ampmLower: "aaa",
  offset: "xx", offsetColon: "xxx", offsetHour: "x", offsetZ: "XX", offsetColonZ: "XXX", offsetHourZ: "X",
  zoneAbbr: { t: "zzz", w: msg("warn.datefnsZoneAbbr") },
  zoneId: { t: null, w: msg("warn.datefnsNoZoneId") },
  unix: "t", unixMs: "T",
};

const MOMENT_Z_NOTE = msg("warn.momentZ");

const MOMENT_MAP: Record<FieldId, Mapping> = {
  year: "YYYY", year2: "YY", isoWeekYear: "GGGG", isoWeek: "WW", quarter: "Q",
  month: "M", month2: "MM", monthShort: "MMM", monthLong: "MMMM",
  day: "D", day2: "DD", daySpace: { t: "D", w: msg("warn.momentDaySpace") },
  daySuffix: { t: null, w: msg("warn.momentNoOrdinal") },
  dayOfYear: "DDD", dayOfYear3: "DDDD",
  dayOfYearSpace: { t: "DDDD", w: msg("warn.momentDayOfYearSpace") },
  dayOfYear0: { t: "DDD", w: msg("warn.momentDayOfYear0") },
  weekdayShort: "ddd", weekdayLong: "dddd", weekdayIso: "E", weekday0: "d",
  hour: "H", hour2: "HH", hourSpace: { t: "H", w: msg("warn.momentHourSpace") },
  hour12: "h", hour12_2: "hh", hour12Space: { t: "h", w: msg("warn.momentHour12Space") },
  minute: "m", minute2: "mm", second: "s", second2: "ss",
  ampm: "A", ampmLower: "a",
  offset: "ZZ", offsetColon: "Z",
  offsetHour: { t: "Z", w: msg("warn.momentOffsetHour") },
  offsetZ: { t: "ZZ", w: MOMENT_Z_NOTE }, offsetColonZ: { t: "Z", w: MOMENT_Z_NOTE },
  offsetHourZ: { t: "Z", w: () => t("warn.join", { first: t("warn.momentOffsetHour"), second: MOMENT_Z_NOTE() }) },
  zoneAbbr: { t: "z", w: msg("warn.momentZoneAbbr") },
  zoneId: { t: null, w: msg("warn.momentNoZoneId") },
  unix: "X", unixMs: "x",
};

// Day.js supports these tokens without plugins. AdvancedFormat adds the second set.
const DAYJS_CORE = new Set(["YY", "YYYY", "M", "MM", "MMM", "MMMM", "D", "DD", "d", "dd", "ddd", "dddd", "H", "HH", "h", "hh", "m", "mm", "s", "ss", "SSS", "Z", "ZZ", "A", "a"]);
const DAYJS_ADVANCED = new Set(["Q", "Do", "k", "kk", "X", "x", "w", "ww", "W", "WW", "gggg", "GGGG", "z", "zzz"]);

const PHP_DAY_OF_YEAR_NOTE = msg("warn.phpDayOfYear");
const PHP_DAY_OF_YEAR_PADDED = () => t("warn.join", { first: t("warn.phpDayOfYear"), second: t("warn.phpZNoPad") });

const PHP_MAP: Record<FieldId, Mapping> = {
  year: "Y", year2: "y", isoWeekYear: "o", isoWeek: "W",
  quarter: { t: null, w: msg("warn.phpNoQuarter") },
  month: "n", month2: "m", monthShort: "M", monthLong: "F",
  day: "j", day2: "d", daySpace: { t: "j", w: msg("warn.phpDaySpace") }, daySuffix: "S",
  dayOfYear: { t: "z", w: PHP_DAY_OF_YEAR_NOTE }, dayOfYear3: { t: "z", w: PHP_DAY_OF_YEAR_PADDED },
  dayOfYearSpace: { t: "z", w: PHP_DAY_OF_YEAR_PADDED }, dayOfYear0: "z",
  weekdayShort: "D", weekdayLong: "l", weekdayIso: "N", weekday0: "w",
  hour: "G", hour2: "H", hourSpace: { t: "G", w: msg("warn.phpHourSpace") },
  hour12: "g", hour12_2: "h", hour12Space: { t: "g", w: msg("warn.phpHour12Space") },
  minute: { t: "i", w: msg("warn.phpMinute") }, minute2: "i",
  second: { t: "s", w: msg("warn.phpSecond") }, second2: "s",
  ampm: "A", ampmLower: "a",
  offset: "O", offsetColon: "P",
  offsetHour: { t: "O", w: msg("warn.phpOffsetHour") },
  offsetZ: { t: "O", w: msg("warn.phpOffsetZ") },
  offsetColonZ: { t: "p", w: msg("warn.phpOffsetColonZ") },
  offsetHourZ: { t: "O", w: msg("warn.phpOffsetHour") },
  zoneAbbr: "T", zoneId: "e", unix: "U",
  unixMs: { t: "Uv", w: msg("warn.phpUnixMs") },
};

const dotnetNoToken = (what: TKey, code: string): Mapping => ({ t: null, w: () => t("warn.dotnetNoToken", { what: nounKey(what), code }) });

const DOTNET_MAP: Record<FieldId, Mapping> = {
  year: "yyyy", year2: "yy",
  isoWeekYear: dotnetNoToken("noun.isoWeekYear", "ISOWeek.GetYear()"),
  isoWeek: dotnetNoToken("noun.isoWeek", "ISOWeek.GetWeekOfYear()"),
  quarter: dotnetNoToken("noun.quarter", "(date.Month + 2) / 3"),
  month: "M", month2: "MM", monthShort: "MMM", monthLong: "MMMM",
  day: "d", day2: "dd", daySpace: { t: "d", w: msg("warn.dotnetDaySpace") },
  daySuffix: dotnetNoToken("noun.ordinalSuffix", "a helper method"),
  dayOfYear: dotnetNoToken("noun.dayOfYear", "date.DayOfYear"),
  dayOfYear3: dotnetNoToken("noun.dayOfYear", "date.DayOfYear.ToString(\"D3\")"),
  dayOfYearSpace: dotnetNoToken("noun.dayOfYear", "date.DayOfYear"),
  dayOfYear0: dotnetNoToken("noun.dayOfYear", "date.DayOfYear - 1"),
  weekdayShort: "ddd", weekdayLong: "dddd",
  weekdayIso: dotnetNoToken("noun.weekdayNumber", "(int)date.DayOfWeek"),
  weekday0: dotnetNoToken("noun.weekdayNumber", "(int)date.DayOfWeek"),
  hour: "H", hour2: "HH", hourSpace: { t: "H", w: msg("warn.dotnetHourSpace") },
  hour12: "h", hour12_2: "hh", hour12Space: { t: "h", w: msg("warn.dotnetHour12Space") },
  minute: "m", minute2: "mm", second: "s", second2: "ss",
  ampm: "tt", ampmLower: { t: "tt", w: msg("warn.dotnetAmpmLower") },
  offset: { t: "zzz", w: msg("warn.dotnetOffset") },
  offsetColon: "zzz", offsetHour: "zz",
  offsetZ: { t: "K", w: msg("warn.dotnetOffsetZ") },
  offsetColonZ: { t: "K", w: msg("warn.dotnetOffsetColonZ") },
  offsetHourZ: { t: "zz", w: msg("warn.dotnetOffsetHourZ") },
  zoneAbbr: dotnetNoToken("noun.zoneAbbr", "TimeZoneInfo"),
  zoneId: dotnetNoToken("noun.zoneId", "TimeZoneInfo.Local.Id"),
  unix: dotnetNoToken("noun.unixTime", "DateTimeOffset.ToUnixTimeSeconds()"),
  unixMs: dotnetNoToken("noun.unixTime", "DateTimeOffset.ToUnixTimeMilliseconds()"),
};

const FIELD_MAPS: Record<Dialect, Record<FieldId, Mapping>> = {
  go: GO_MAP,
  c: strftimeMap("c"),
  python: strftimeMap("python"),
  ruby: strftimeMap("ruby"),
  java: JAVA_MAP,
  datefns: DATEFNS_MAP,
  moment: MOMENT_MAP,
  php: PHP_MAP,
  dotnet: DOTNET_MAP,
};

/** The token a dialect uses for a field, or null when it has none. For the reference table. */
export const tokenFor = (field: FieldId, dialect: Dialect): string | null => {
  const mapping = FIELD_MAPS[dialect][field];
  return typeof mapping === "string" ? mapping : mapping.t;
};

function emitFraction(part: Extract<Part, { kind: "fraction" }>, dialect: Dialect, warn: (w: string) => void): string | null {
  const { digits: n, trim } = part;
  const fixed = (name: string, token: string) => trim && warn(t("warn.fractionTrim", { name, token }));
  switch (dialect) {
    case "go":
      return (trim ? "9" : "0").repeat(n);
    case "c":
      warn(t("warn.cNoFraction"));
      return null;
    case "python":
      if (n !== 6) warn(t("warn.pythonFraction", { digits: n }));
      fixed("Python", "%f");
      return "%f";
    case "ruby": {
      const token = n === 3 ? "%L" : n === 9 ? "%N" : `%${n}N`;
      fixed("Ruby", token);
      return token;
    }
    case "java":
    case "datefns":
    case "moment": {
      const token = "S".repeat(n);
      fixed(DIALECT_LABELS[dialect], token);
      return token;
    }
    case "php": {
      const token = n <= 3 ? "v" : "u";
      if (n !== 3 && n !== 6) warn(t("warn.phpFraction", { digits: n, token }));
      fixed("PHP", token);
      warn(t("warn.phpFractionZeros", { token }));
      return token;
    }
    case "dotnet":
      if (n > 7) warn(t("warn.dotnetFraction7"));
      return (trim ? "F" : "f").repeat(Math.min(n, 7));
  }
}

const quoteRuns = (text: string, needsQuote: (c: string) => boolean, quote: (run: string) => string, plain: (c: string) => string = (c) => c) => {
  let out = "";
  let run = "";
  for (const c of text) {
    if (needsQuote(c)) {
      run += c;
    } else {
      if (run) out += quote(run);
      run = "";
      out += plain(c);
    }
  }
  if (run) out += quote(run);
  return out;
};

function emitLiteral(text: string, dialect: Dialect, warn: (w: string) => void): string {
  switch (dialect) {
    case "go":
      return text;
    case "c":
    case "python":
    case "ruby":
      return text.replace(/%/g, "%%");
    case "java":
    case "datefns": {
      // A quote inside quoted text doubles. A run of only quotes needs no quoting: '' is one quote.
      const special = dialect === "java" ? "'[]{}#" : "'";
      const quote = (run: string) => (/^'+$/.test(run) ? run.replace(/'/g, "''") : `'${run.replace(/'/g, "''")}'`);
      return quoteRuns(text, (c) => isLetter(c) || special.includes(c), quote);
    }
    case "moment":
      if (/[[\]]/.test(text)) warn(t("warn.momentBrackets"));
      return quoteRuns(text, isLetter, (run) => `[${run}]`);
    case "php":
      return text.replace(/[A-Za-z\\]/g, (c) => `\\${c}`);
    case "dotnet":
      if (text.includes("/")) warn(t("warn.dotnetSlash"));
      return quoteRuns(text, isLetter, (run) => `'${run}'`, (c) => ("'\"\\%".includes(c) ? `\\${c}` : c));
  }
}

const tokenKey = (part: Part) =>
  part.kind === "field" ? part.field : part.kind === "fraction" ? `fraction:${part.digits}:${part.trim}` : part.kind === "raw" ? `raw:${part.text}` : "";

const tokenKeys = (parts: Part[]) => parts.map(tokenKey).filter(Boolean);

export function emitFormat(parts: Part[], dialect: Dialect): EmitResult {
  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const map = FIELD_MAPS[dialect];
  // Each piece is a token or escaped literal text. Tokens are kept apart to check the result.
  const pieces: { text: string; token: boolean }[] = [];
  const push = (text: string, token: boolean) => pieces.push({ text, token });
  let lastDay: number | null = null;

  for (const part of parts) {
    if (part.kind === "literal") {
      if (part.text) push(emitLiteral(part.text, dialect, warn), false);
      lastDay = null;
      continue;
    }
    if (part.kind === "raw") {
      if (part.dialect === dialect || (["c", "python", "ruby"].includes(part.dialect) && ["c", "python", "ruby"].includes(dialect))) {
        push(part.text, true);
      } else {
        warn(t("warn.noEquivalent", { name: DIALECT_LABELS[dialect], token: part.text, label: part.label }));
      }
      lastDay = null;
      continue;
    }
    if (part.kind === "fraction") {
      const token = emitFraction(part, dialect, warn);
      if (token !== null) {
        if (dialect === "go") {
          if (!part.sep) warn(t("warn.goDot"));
          push(`${part.sep || "."}${token}`, true);
        } else {
          if (part.sep) push(emitLiteral(part.sep, dialect, warn), false);
          push(token, true);
        }
      }
      lastDay = null;
      continue;
    }
    // Moment.js and date-fns write the ordinal suffix as one token with the day: Do and do.
    if (part.field === "daySuffix" && (dialect === "moment" || dialect === "datefns") && lastDay !== null) {
      const token = dialect === "moment" ? "Do" : "do";
      if (pieces[lastDay].text !== (dialect === "moment" ? "D" : "d")) warn(t("warn.ordinalNoPad", { token }));
      pieces[lastDay] = { text: token, token: true };
      lastDay = null;
      continue;
    }
    const mapping = map[part.field];
    const token = typeof mapping === "string" ? mapping : mapping.t;
    if (typeof mapping !== "string") warn(mapping.w());
    if (token !== null) push(token, true);
    lastDay = token !== null && (part.field === "day" || part.field === "day2" || part.field === "daySpace") ? pieces.length - 1 : null;
  }

  let format = pieces.map((p) => p.text).join("");
  if (dialect === "dotnet" && pieces.length === 1 && pieces[0].token && pieces[0].text.length === 1) format = `%${format}`;

  if (dialect === "moment") {
    const tokens = pieces.filter((p) => p.token).map((p) => p.text);
    const plugin = tokens.filter((tok) => DAYJS_ADVANCED.has(tok));
    const missing = tokens.filter((tok) => !DAYJS_CORE.has(tok) && !DAYJS_ADVANCED.has(tok));
    if (plugin.length) warn(t("warn.dayjsPlugin", { tokens: [...new Set(plugin)].join(", ") }));
    if (missing.length) warn(t("warn.dayjsUnsupported", { tokens: [...new Set(missing)].join(", ") }));
  }

  // Read the result back. A difference means literal text merged into a token.
  const reparse = (text: string) => (dialect === "dotnet" ? parseDotnet(text, false) : parseFormat(text, dialect));
  const expected = pieces.filter((p) => p.token).flatMap((p) => tokenKeys(reparse(p.text).parts));
  const actual = tokenKeys(reparse(format).parts);
  if (expected.join(" ") !== actual.join(" ")) {
    warn(
      dialect === "go"
        ? t("warn.goNoEscape")
        : t("warn.merged"),
    );
  }
  return { format, warnings };
}

export interface Translation {
  source: Dialect;
  detected: boolean;
  parts: Part[];
  warnings: string[];
  targets: Record<Dialect, EmitResult>;
}

/** Parses `format` in `source` (or the detected dialect) and emits it in every dialect. */
export function translateFormat(format: string, source: Dialect | "auto" = "auto"): Translation {
  const dialect = source === "auto" ? detectDialect(format) : source;
  const { parts, warnings } = parseFormat(format, dialect);
  const targets = Object.fromEntries(
    DIALECTS.map(({ id }) => [id, id === dialect ? { format, warnings: [] } : emitFormat(parts, id)]),
  ) as Record<Dialect, EmitResult>;
  return { source: dialect, detected: source === "auto", parts, warnings, targets };
}

// ---------------------------------------------------------------------------------------------
// Rendering a preview

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface RenderOptions {
  /** Render in UTC instead of the local time zone. */
  utc?: boolean;
}

const pad = (n: number, width: number, fill = "0") => String(n).padStart(width, fill);

const localZone = (date: Date) => {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value;
    return { abbr: name ?? "", id: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "" };
  } catch {
    return { abbr: "", id: "" };
  }
};

function dateFields(date: Date, utc: boolean) {
  const y = utc ? date.getUTCFullYear() : date.getFullYear();
  const mo = utc ? date.getUTCMonth() : date.getMonth();
  const d = utc ? date.getUTCDate() : date.getDate();
  const wd = utc ? date.getUTCDay() : date.getDay();
  const h = utc ? date.getUTCHours() : date.getHours();
  const mi = utc ? date.getUTCMinutes() : date.getMinutes();
  const s = utc ? date.getUTCSeconds() : date.getSeconds();
  const ms = utc ? date.getUTCMilliseconds() : date.getMilliseconds();
  const offset = utc ? 0 : -date.getTimezoneOffset();
  const dayOfYear = (Date.UTC(y, mo, d) - Date.UTC(y, 0, 1)) / 86_400_000 + 1;
  const thursday = new Date(Date.UTC(y, mo, d + 4 - (wd || 7)));
  const isoYear = thursday.getUTCFullYear();
  const isoWeek = Math.ceil(((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / 86_400_000 + 1) / 7);
  const zone = utc ? { abbr: "UTC", id: "UTC" } : localZone(date);
  return { y, mo, d, wd, h, mi, s, ms, offset, dayOfYear, isoYear, isoWeek, zone, time: date.getTime() };
}

const formatOffset = (minutes: number, colon: boolean, hoursOnly: boolean, z: boolean) => {
  if (z && minutes === 0) return "Z";
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = pad(Math.floor(abs / 60), 2);
  if (hoursOnly) return `${sign}${hh}`;
  return `${sign}${hh}${colon ? ":" : ""}${pad(abs % 60, 2)}`;
};

const ordinalSuffix = (n: number) => {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
};

/** Renders parsed parts for a date. The output is what the target libraries print by default, so month and weekday names stay English. */
export function renderParts(parts: Part[], date: Date, options: RenderOptions = {}): string {
  const f = dateFields(date, !!options.utc);
  const h12 = f.h % 12 || 12;
  const value = (field: FieldId): string => {
    switch (field) {
      case "year": return pad(f.y, 4);
      case "year2": return pad(f.y % 100, 2);
      case "isoWeekYear": return pad(f.isoYear, 4);
      case "isoWeek": return pad(f.isoWeek, 2);
      case "quarter": return String(Math.floor(f.mo / 3) + 1);
      case "month": return String(f.mo + 1);
      case "month2": return pad(f.mo + 1, 2);
      case "monthShort": return MONTHS[f.mo].slice(0, 3);
      case "monthLong": return MONTHS[f.mo];
      case "day": return String(f.d);
      case "day2": return pad(f.d, 2);
      case "daySpace": return pad(f.d, 2, " ");
      case "daySuffix": return ordinalSuffix(f.d);
      case "dayOfYear": return String(f.dayOfYear);
      case "dayOfYear3": return pad(f.dayOfYear, 3);
      case "dayOfYearSpace": return pad(f.dayOfYear, 3, " ");
      case "dayOfYear0": return String(f.dayOfYear - 1);
      case "weekdayShort": return WEEKDAYS[f.wd].slice(0, 3);
      case "weekdayLong": return WEEKDAYS[f.wd];
      case "weekdayIso": return String(f.wd || 7);
      case "weekday0": return String(f.wd);
      case "hour": return String(f.h);
      case "hour2": return pad(f.h, 2);
      case "hourSpace": return pad(f.h, 2, " ");
      case "hour12": return String(h12);
      case "hour12_2": return pad(h12, 2);
      case "hour12Space": return pad(h12, 2, " ");
      case "minute": return String(f.mi);
      case "minute2": return pad(f.mi, 2);
      case "second": return String(f.s);
      case "second2": return pad(f.s, 2);
      case "ampm": return f.h < 12 ? "AM" : "PM";
      case "ampmLower": return f.h < 12 ? "am" : "pm";
      case "offset": return formatOffset(f.offset, false, false, false);
      case "offsetColon": return formatOffset(f.offset, true, false, false);
      case "offsetHour": return formatOffset(f.offset, false, true, false);
      case "offsetZ": return formatOffset(f.offset, false, false, true);
      case "offsetColonZ": return formatOffset(f.offset, true, false, true);
      case "offsetHourZ": return formatOffset(f.offset, false, true, true);
      case "zoneAbbr": return f.zone.abbr;
      case "zoneId": return f.zone.id;
      case "unix": return String(Math.floor(f.time / 1000));
      case "unixMs": return String(f.time);
    }
  };
  return parts
    .map((part) => {
      switch (part.kind) {
        case "literal":
          return part.text;
        case "field":
          return value(part.field);
        case "fraction": {
          let digits = pad(f.ms, 3).padEnd(part.digits, "0").slice(0, part.digits);
          if (part.trim) digits = digits.replace(/0+$/, "");
          return digits ? `${part.sep}${digits}` : "";
        }
        case "raw":
          return part.text;
      }
    })
    .join("");
}

/** Renders a format string, as the given dialect reads it, for a date. */
export const renderFormat = (format: string, dialect: Dialect, date: Date, options: RenderOptions = {}) =>
  renderParts(parseFormat(format, dialect).parts, date, options);
