/**
 * Cron expression parsing, plain-English descriptions, and next-run search.
 *
 * Dialects:
 * - standard: 5 fields (minute hour day-of-month month day-of-week). 0 and 7 are Sunday.
 *   When both day fields are restricted, a day that matches either one runs (Vixie cron rule).
 * - seconds: 6 fields with seconds first (Spring, node-cron). Both day fields must match.
 * - quartz: 6 or 7 fields with seconds first and an optional year. Uses `?`, and 1 is Sunday.
 * - aws: EventBridge `cron(...)`: minute hour day-of-month month day-of-week year. 1 is Sunday.
 */

import { LOCALES, getLocale, t } from "./lib/i18n";

export type CronDialect = "standard" | "seconds" | "quartz" | "aws";
export type CronFieldName = "second" | "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek" | "year";

export type CronItem =
  | { kind: "all"; any: boolean }
  | { kind: "value"; value: number }
  | { kind: "range"; from: number; to: number }
  | { kind: "step"; from: number; to: number; step: number; star: boolean }
  | { kind: "last" }
  | { kind: "lastOffset"; offset: number }
  | { kind: "nearestWeekday"; day: number }
  | { kind: "lastWeekday" }
  | { kind: "lastDayOfWeek"; day: number }
  | { kind: "nthDayOfWeek"; day: number; nth: number };

export interface CronField {
  name: CronFieldName;
  text: string;
  items: CronItem[];
  /** Plain matching values, sorted. Day of week is normalized to 0-6 with 0 as Sunday. */
  values: number[];
  /** True when the field is `*` or `?`. */
  wildcard: boolean;
}

export interface CronSchedule {
  dialect: CronDialect;
  fields: CronField[];
  /** The macro as typed, such as `@daily`. */
  macro?: string;
  /** The 5-field form of a macro. */
  expanded?: string;
  /** Standard cron runs on a day that matches either day field when both are restricted. */
  dayOr: boolean;
}

export type CronParseResult =
  | { ok: true; schedule: CronSchedule }
  | { ok: false; error: string; fieldIndex?: number; layout?: CronFieldName[] };

/** The field's name in the current language, e.g. "Day of month". */
export const cronFieldLabel = (name: CronFieldName): string => t(`cron.field.${name}`);

// The names in the expression are code (JAN, MON) and never change. The names in descriptions follow the app language.
const MONTH_CODES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const ORDINAL_KEYS = ["cron.ordinal.1", "cron.ordinal.2", "cron.ordinal.3", "cron.ordinal.4", "cron.ordinal.5"] as const;

const nameFormatters = new Map<string, Intl.DateTimeFormat>();
/** A month or weekday name in the app language. `index` is 0-11 for a month and 0-6 (0 is Sunday) for a weekday. */
function calendarName(kind: "month" | "weekday", index: number): string {
  const key = `${getLocale()}:${kind}`;
  let formatter = nameFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(LOCALES[getLocale()].tag, { timeZone: "UTC", ...(kind === "month" ? { month: "long" } : { weekday: "long" }) });
    nameFormatters.set(key, formatter);
  }
  // 2023-01-01 was a Sunday.
  return formatter.format(kind === "month" ? Date.UTC(2023, index, 1) : Date.UTC(2023, 0, 1 + index));
}
const monthName = (index: number) => calendarName("month", index);
const dayName = (index: number) => calendarName("weekday", index);

const LAYOUTS: Record<CronDialect, CronFieldName[]> = {
  standard: ["minute", "hour", "dayOfMonth", "month", "dayOfWeek"],
  seconds: ["second", "minute", "hour", "dayOfMonth", "month", "dayOfWeek"],
  quartz: ["second", "minute", "hour", "dayOfMonth", "month", "dayOfWeek", "year"],
  aws: ["minute", "hour", "dayOfMonth", "month", "dayOfWeek", "year"],
};

export const cronDialectLabel = (dialect: CronDialect): string => t(`cron.dialect.${dialect}`);

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

/** Allowed values as typed, per field. Day of week depends on the dialect. */
interface FieldSpec {
  min: number;
  max: number;
  /** Range that `*` covers. */
  starMin: number;
  starMax: number;
  hint: string;
  /** The hint for a number that is out of range: numbers only, no names. */
  numbers: string;
}

const sundayIsOne = (dialect: CronDialect) => dialect === "quartz" || dialect === "aws";

function fieldSpec(name: CronFieldName, dialect: CronDialect): FieldSpec {
  const plain = (min: number, max: number): FieldSpec => {
    const hint = t("cron.hint.range", { min, max });
    return { min, max, starMin: min, starMax: max, hint, numbers: hint };
  };
  switch (name) {
    case "second":
    case "minute":
      return plain(0, 59);
    case "hour":
      return plain(0, 23);
    case "dayOfMonth":
      return plain(1, 31);
    case "month":
      return { ...plain(1, 12), hint: t("cron.hint.month") };
    case "year":
      return plain(1970, 2099);
    case "dayOfWeek":
      return sundayIsOne(dialect)
        ? { min: 1, max: 7, starMin: 1, starMax: 7, hint: t("cron.hint.dayOfWeekOne"), numbers: t("cron.hint.dayOfWeekOneNumbers") }
        : { min: 0, max: 7, starMin: 0, starMax: 6, hint: t("cron.hint.dayOfWeekZero"), numbers: t("cron.hint.dayOfWeekZeroNumbers") };
  }
}

/** Map a typed day-of-week number to 0-6 with 0 as Sunday. */
const normalizeDay = (value: number, dialect: CronDialect) => (sundayIsOne(dialect) ? value - 1 : value % 7);

class FieldError extends Error {}

function parseNumber(text: string, name: CronFieldName, dialect: CronDialect): number {
  const field = cronFieldLabel(name);
  const spec = fieldSpec(name, dialect);
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    if (value < spec.min || value > spec.max) throw new FieldError(t("cron.error.outOfRange", { field, value, range: spec.numbers }));
    return value;
  }
  const upper = text.toUpperCase();
  if (name === "month") {
    const index = MONTH_CODES.indexOf(upper);
    if (index === -1) throw new FieldError(t("cron.error.notMonth", { field, text, hint: spec.hint }));
    return index + 1;
  }
  if (name === "dayOfWeek") {
    const index = DAY_CODES.indexOf(upper);
    if (index === -1) throw new FieldError(t("cron.error.notDay", { field, text, hint: spec.hint }));
    return sundayIsOne(dialect) ? index + 1 : index;
  }
  throw new FieldError(t("cron.error.notNumber", { field, text, hint: spec.hint }));
}

function parseItem(text: string, name: CronFieldName, dialect: CronDialect): CronItem {
  const field = cronFieldLabel(name);
  const isDayField = name === "dayOfMonth" || name === "dayOfWeek";
  const spec = fieldSpec(name, dialect);
  const upper = text.toUpperCase();

  if (text === "*") return { kind: "all", any: false };
  if (text === "?") {
    if (!isDayField) throw new FieldError(t("cron.error.questionOnlyDay", { field }));
    return { kind: "all", any: true };
  }
  if (text === "") throw new FieldError(t("cron.error.emptyItem", { field }));

  if (name === "dayOfMonth") {
    if (upper === "L") return { kind: "last" };
    if (upper === "LW") return { kind: "lastWeekday" };
    const offset = /^L-(\d+)$/i.exec(text);
    if (offset) {
      const value = Number(offset[1]);
      if (value < 1 || value > 30) throw new FieldError(t("cron.error.offsetRange", { field, text }));
      return { kind: "lastOffset", offset: value };
    }
    const weekday = /^(\d+)W$/i.exec(text);
    if (weekday) return { kind: "nearestWeekday", day: parseNumber(weekday[1], name, dialect) };
  }
  if (name === "dayOfWeek") {
    // Quartz reads a lone L in this field as Saturday.
    if (upper === "L") return { kind: "value", value: sundayIsOne(dialect) ? 7 : 6 };
    const last = /^(\w+)L$/i.exec(text);
    if (last) return { kind: "lastDayOfWeek", day: normalizeDay(parseNumber(last[1], name, dialect), dialect) };
    const nth = /^(\w+)#(\d+)$/.exec(text);
    if (nth) {
      const count = Number(nth[2]);
      if (count < 1 || count > 5) throw new FieldError(t("cron.error.nthRange", { field, text }));
      return { kind: "nthDayOfWeek", day: normalizeDay(parseNumber(nth[1], name, dialect), dialect), nth: count };
    }
  }
  if (!isDayField && name !== "month" && /[LW#]/i.test(text)) {
    throw new FieldError(t("cron.error.lwOnlyDay", { field, text }));
  }

  const slash = text.split("/");
  if (slash.length > 2) throw new FieldError(t("cron.error.multiSlash", { field, text }));
  if (slash.length === 2) {
    const [base, stepText] = slash;
    const step = /^\d+$/.test(stepText) ? Number(stepText) : 0;
    if (step < 1) throw new FieldError(t("cron.error.stepInvalid", { field, text }));
    if (base === "*" || base === "?") return { kind: "step", from: spec.starMin, to: spec.starMax, step, star: true };
    if (base.includes("-")) {
      const range = parseRange(base, name, dialect);
      return { kind: "step", from: range.from, to: range.to, step, star: false };
    }
    return { kind: "step", from: parseNumber(base, name, dialect), to: spec.starMax, step, star: false };
  }
  if (text.includes("-")) return parseRange(text, name, dialect);
  return { kind: "value", value: parseNumber(text, name, dialect) };
}

function parseRange(text: string, name: CronFieldName, dialect: CronDialect): { kind: "range"; from: number; to: number } {
  const field = cronFieldLabel(name);
  const parts = text.split("-");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new FieldError(t("cron.error.rangeInvalid", { field, text }));
  const from = parseNumber(parts[0], name, dialect);
  const to = parseNumber(parts[1], name, dialect);
  if (from > to) {
    throw new FieldError(t("cron.error.rangeBackward", { field, from: parts[0], to: parts[1] }));
  }
  return { kind: "range", from, to };
}

function parseField(text: string, name: CronFieldName, dialect: CronDialect): CronField {
  const items = text.split(",").map((part) => parseItem(part, name, dialect));
  const set = new Set<number>();
  const spec = fieldSpec(name, dialect);
  const add = (value: number) => set.add(name === "dayOfWeek" ? normalizeDay(value, dialect) : value);
  for (const item of items) {
    if (item.kind === "all") for (let v = spec.starMin; v <= spec.starMax; v++) add(v);
    else if (item.kind === "value") add(item.value);
    else if (item.kind === "range") for (let v = item.from; v <= item.to; v++) add(v);
    else if (item.kind === "step") for (let v = item.from; v <= item.to; v += item.step) add(v);
  }
  // Store day-of-week items in 0-6 form so descriptions can name them directly.
  const normalized = name === "dayOfWeek" ? items.map((item) => normalizeDayItem(item, dialect)) : items;
  return {
    name,
    text,
    items: normalized,
    values: [...set].sort((a, b) => a - b),
    wildcard: items.length === 1 && items[0].kind === "all",
  };
}

function normalizeDayItem(item: CronItem, dialect: CronDialect): CronItem {
  switch (item.kind) {
    case "value":
      return { kind: "value", value: normalizeDay(item.value, dialect) };
    case "range":
      return { kind: "range", from: normalizeDay(item.from, dialect), to: normalizeDay(item.to, dialect) };
    default:
      return item;
  }
}

function detectLayout(tokens: string[], aws: boolean): CronFieldName[] | null {
  const dialect = detectDialect(tokens, aws);
  return dialect ? LAYOUTS[dialect].slice(0, tokens.length) : null;
}

function detectDialect(tokens: string[], aws: boolean): CronDialect | null {
  if (aws) return tokens.length === 6 ? "aws" : null;
  if (tokens.length === 5) return "standard";
  if (tokens.length === 6) return tokens.some((token) => token.includes("?")) ? "quartz" : "seconds";
  if (tokens.length === 7) return "quartz";
  return null;
}

/** Parse a cron expression. Pass `aws` for the inside of an EventBridge `cron(...)` wrapper. */
export function parseCron(expression: string, options: { aws?: boolean } = {}): CronParseResult {
  const trimmed = expression.trim();
  if (!trimmed) return { ok: false, error: t("cron.error.empty") };

  if (trimmed.startsWith("@")) {
    const macro = trimmed.toLowerCase();
    if (macro === "@reboot") {
      return { ok: false, error: t("cron.error.reboot") };
    }
    const expanded = MACROS[macro];
    if (!expanded) {
      return { ok: false, error: t("cron.error.unknownMacro", { macro: trimmed }) };
    }
    const result = parseCron(expanded);
    if (result.ok) result.schedule = { ...result.schedule, macro: trimmed, expanded };
    return result;
  }

  const tokens = trimmed.split(/\s+/);
  const dialect = detectDialect(tokens, options.aws ?? false);
  if (!dialect) {
    const error = options.aws
      ? t("cron.error.awsFields", { found: tokens.length })
      : t("cron.error.fieldCount", { found: tokens.length });
    return { ok: false, error };
  }
  const layout = LAYOUTS[dialect].slice(0, tokens.length);

  const fields: CronField[] = [];
  for (let index = 0; index < tokens.length; index++) {
    try {
      fields.push(parseField(tokens[index], layout[index], dialect));
    } catch (error) {
      if (error instanceof FieldError) return { ok: false, error: error.message, fieldIndex: index, layout };
      throw error;
    }
  }

  const dayOfMonth = fields[layout.indexOf("dayOfMonth")];
  const dayOfWeek = fields[layout.indexOf("dayOfWeek")];
  const starred = (field: CronField) => field.text.startsWith("*") || field.text.startsWith("?");
  const dayOr = dialect === "standard" && !starred(dayOfMonth) && !starred(dayOfWeek);
  return { ok: true, schedule: { dialect, fields, dayOr } };
}

/** The field names for the typed tokens, or null when the token count fits no dialect. */
export function cronLayout(expression: string, aws = false): CronFieldName[] | null {
  const trimmed = expression.trim();
  if (trimmed.startsWith("@")) return MACROS[trimmed.toLowerCase()] ? LAYOUTS.standard : null;
  return trimmed ? detectLayout(trimmed.split(/\s+/), aws) : null;
}

/* ------------------------------------------------------------------------- */
/* Reading pasted text                                                       */
/* ------------------------------------------------------------------------- */

export interface CronInput {
  /** The cron expression without keys, quotes, prefixes, or a command. */
  expression: string;
  /** Offsets of the expression inside the original text. */
  start: number;
  end: number;
  /** The command that follows the schedule in a crontab line. */
  command?: string;
  /** A `CRON_TZ=` or `TZ=` prefix. */
  timeZone?: string;
  /** True for an AWS EventBridge `cron(...)` wrapper. */
  aws: boolean;
}

const CRON_PIECE = new RegExp(`^(?:\\*|\\?|\\d+|L|W|LW|\\d+[LW]|${[...MONTH_CODES, ...DAY_CODES].join("|")})$`, "i");
const looksLikeCronField = (token: string) => token.split(/[,\-/#]/).every((piece) => CRON_PIECE.test(piece));

/**
 * Find the cron expression in pasted text. Accepts crontab lines with a command, GitHub Actions
 * and Kubernetes YAML lines (`- cron: '...'`, `schedule: "..."`), `CRON_TZ=` prefixes, and AWS `cron(...)`.
 */
export function readCronInput(text: string): CronInput {
  let start = 0;
  let end = text.length;
  const skipSpace = () => {
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
  };
  skipSpace();

  const key = /^(?:-\s*)?(?:cron|schedule)\s*:\s*/i.exec(text.slice(start, end));
  if (key) start += key[0].length;
  const quote = text[start];
  if ((quote === "'" || quote === '"') && text.indexOf(quote, start + 1) > start) {
    end = text.indexOf(quote, start + 1);
    start++;
    skipSpace();
  }

  let aws = false;
  const wrapper = /^cron\((.*)\)$/i.exec(text.slice(start, end));
  if (wrapper) {
    aws = true;
    start += 5;
    end -= 1;
    skipSpace();
  }

  let timeZone: string | undefined;
  const zone = /^(?:CRON_TZ|TZ)=(\S+)\s+/.exec(text.slice(start, end));
  if (zone) {
    timeZone = zone[1];
    start += zone[0].length;
  }

  // Tokens with their offsets, so the command can be split off.
  const tokens: { value: string; start: number; end: number }[] = [];
  const pattern = /\S+/g;
  const body = text.slice(start, end);
  for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
    tokens.push({ value: match[0], start: start + match.index, end: start + match.index + match[0].length });
  }

  let count = tokens.length;
  if (tokens[0]?.value.startsWith("@")) {
    count = 1;
  } else if (!aws) {
    let leading = 0;
    while (leading < tokens.length && leading < 7 && looksLikeCronField(tokens[leading].value)) leading++;
    if (leading >= 5) count = leading;
  }

  const fieldEnd = count > 0 ? tokens[count - 1].end : start;
  const command = count < tokens.length ? text.slice(tokens[count].start, end) : undefined;
  return { expression: text.slice(start, fieldEnd), start, end: fieldEnd, command, timeZone, aws };
}

/** Replace one field of the expression inside `text`. A macro becomes its 5-field form first. */
export function replaceCronField(text: string, index: number, value: string): string {
  const input = readCronInput(text);
  const macro = MACROS[input.expression.toLowerCase()];
  const tokens = (macro ?? input.expression).split(/\s+/);
  tokens[index] = value;
  return text.slice(0, input.start) + tokens.join(" ") + text.slice(input.end);
}

/* ------------------------------------------------------------------------- */
/* Descriptions                                                              */
/* ------------------------------------------------------------------------- */

const pad = (value: number) => String(value).padStart(2, "0");

/** "A, B and C" in the app language. */
function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return t(/^\d/.test(items[items.length - 1]) ? "cron.list.andNumber" : "cron.list.and", { items: items.slice(0, -1).join(t("cron.list.separator")), last: items[items.length - 1] });
}

type NumberedUnit = "second" | "minute" | "hour" | "dayOfMonth";

function valueName(name: CronFieldName, value: number): string {
  if (name === "month") return monthName(value - 1);
  if (name === "dayOfWeek") return dayName(value);
  return String(value);
}

const named = (name: CronFieldName) => name === "month" || name === "dayOfWeek" || name === "year";

function describeItem(name: CronFieldName, item: CronItem): string {
  const show = (value: number) => (named(name) ? valueName(name, value) : t(`cron.value.${name as NumberedUnit}`, { value }));
  switch (item.kind) {
    case "all":
      return item.any ? t("cron.any") : t(`cron.every.${name}`);
    case "value":
      return show(item.value);
    case "range":
      return named(name)
        ? t("cron.rangeNamed", { from: valueName(name, item.from), to: valueName(name, item.to) })
        : t(`cron.range.${name as NumberedUnit}`, { from: item.from, to: item.to });
    case "step": {
      const every = t(`cron.step.${name}`, { count: item.step });
      if (item.star) return every;
      return t("cron.stepFrom", { every, from: named(name) ? valueName(name, item.from) : item.from, to: named(name) ? valueName(name, item.to) : item.to });
    }
    case "last":
      return t("cron.last");
    case "lastOffset":
      return t("cron.lastOffset", { count: item.offset });
    case "nearestWeekday":
      return t("cron.nearestWeekday", { day: item.day });
    case "lastWeekday":
      return t("cron.lastWeekday");
    case "lastDayOfWeek":
      return t("cron.lastDayOfWeek", { day: dayName(item.day) });
    case "nthDayOfWeek":
      return t("cron.nthDayOfWeek", { nth: t(ORDINAL_KEYS[item.nth - 1]), day: dayName(item.day) });
  }
}

/** Describe one field on its own, for the field breakdown. */
export function describeCronField(field: CronField): string {
  const { name, items } = field;
  if (items.every((item) => item.kind === "value")) {
    const values = items.map((item) => (item as { value: number }).value);
    if (named(name)) return joinList(values.map((value) => valueName(name, value)));
    return t(`cron.values.${name as NumberedUnit}`, { count: values.length, list: joinList(values.map(String)) });
  }
  return joinList(items.map((item) => describeItem(name, item)));
}

function dayOfMonthPhrase(field: CronField): string {
  const items = field.items;
  if (items.every((item) => item.kind === "value" || item.kind === "range")) return t("cron.on.dayOfMonth", { text: describeCronField(field) });
  return t("cron.on", { text: describeCronField(field) });
}

/** Describe the whole schedule in one plain sentence in the app language. */
export function describeCron(schedule: CronSchedule): string {
  const get = (name: CronFieldName) => schedule.fields.find((field) => field.name === name);
  const second = get("second");
  const minute = get("minute")!;
  const hour = get("hour")!;
  const dayOfMonth = get("dayOfMonth")!;
  const month = get("month")!;
  const dayOfWeek = get("dayOfWeek")!;
  const year = get("year");

  const onlyValues = (field: CronField | undefined) => !field || field.items.every((item) => item.kind === "value");
  const seconds = second ? second.values : [0];
  const trivialSeconds = seconds.length === 1 && seconds[0] === 0;
  const parts: string[] = [];
  let exactTimes = false;

  const combos = seconds.length * minute.values.length * hour.values.length;
  if (onlyValues(second) && onlyValues(minute) && !hour.wildcard && combos <= 6 && hour.values.length <= 6) {
    const times: string[] = [];
    for (const h of hour.values) {
      for (const m of minute.values) {
        for (const s of seconds) times.push(trivialSeconds ? `${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(s)}`);
      }
    }
    parts.push(t("cron.atTime", { text: joinList(times) }));
    exactTimes = true;
  } else {
    let timeText = "";
    if (second && !trivialSeconds) {
      if (second.wildcard) timeText = t("cron.every.second");
      else if (second.items.every((item) => item.kind === "step" && item.star)) timeText = describeCronField(second);
      else timeText = t(minute.wildcard ? "cron.atOfEveryMinute" : "cron.at", { text: describeCronField(second) });
    }
    if (!minute.wildcard || !timeText) {
      const minuteText = minute.wildcard
        ? t("cron.every.minute")
        : onlyValues(minute)
          ? t(hour.wildcard ? "cron.atOfEveryHour" : "cron.at", { text: describeCronField(minute) })
          : describeCronField(minute);
      timeText = timeText ? [timeText, minuteText].join(t("cron.part.separator")) : minuteText;
    }
    parts.push(timeText);
    if (!hour.wildcard) {
      const single = hour.items.length === 1 ? hour.items[0] : undefined;
      if (single?.kind === "range") parts.push(t("cron.between", { from: `${pad(single.from)}:00`, to: `${pad(single.to)}:59` }));
      else if (hour.items.every((item) => item.kind === "step")) parts.push(describeCronField(hour));
      else parts.push(t("cron.during", { text: describeCronField(hour) }));
    }
  }

  const domRestricted = !dayOfMonth.wildcard;
  const dowRestricted = !dayOfWeek.wildcard;
  if (domRestricted && dowRestricted) {
    parts.push(t(schedule.dayOr ? "cron.dayOrWeekday" : "cron.dayAndWeekday", { day: dayOfMonthPhrase(dayOfMonth), weekday: describeCronField(dayOfWeek) }));
  } else if (domRestricted) {
    parts.push(dayOfMonthPhrase(dayOfMonth));
  } else if (dowRestricted) {
    parts.push(t("cron.onWeekday", { text: describeCronField(dayOfWeek) }));
  }

  if (!month.wildcard) {
    parts.push(month.items.every((item) => item.kind === "step") ? describeCronField(month) : t("cron.in", { text: describeCronField(month) }));
  }
  if (year && !year.wildcard) parts.push(t("cron.inYear", { text: describeCronField(year) }));
  if (exactTimes && !domRestricted && !dowRestricted && month.wildcard) parts.push(t("cron.every.dayOfMonth"));

  const sentence = parts.join(t("cron.part.separator"));
  return sentence.charAt(0).toLocaleUpperCase(LOCALES[getLocale()].tag) + sentence.slice(1);
}

/** Compact list of matching values for a field, such as `0, 6, 12, 18` or `MON-FRI`. */
export function formatCronValues(field: CronField): string {
  const values = field.values;
  const show = (value: number) =>
    field.name === "month" ? MONTH_CODES[value - 1] : field.name === "dayOfWeek" ? DAY_CODES[value] : String(value);
  const ranges: string[] = [];
  for (let i = 0; i < values.length; i++) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
    ranges.push(j - i >= 2 ? `${show(values[i])}-${show(values[j])}` : j > i ? `${show(values[i])}, ${show(values[j])}` : show(values[i]));
    i = j;
  }
  return ranges.join(", ");
}

/* ------------------------------------------------------------------------- */
/* Next runs                                                                 */
/* ------------------------------------------------------------------------- */

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

function wallTime(instant: number, timeZone: string | undefined): WallTime {
  const parts: Record<string, number> = {};
  for (const part of wallFormatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute, second: parts.second };
}

const wallAsUtc = (wall: WallTime) => Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);

/** Convert a wall-clock time in a zone to an instant. Returns null for times skipped by daylight saving time. */
function wallToInstant(wall: WallTime, timeZone: string | undefined): number | null {
  const guess = wallAsUtc(wall);
  const offset = wallAsUtc(wallTime(guess, timeZone)) - guess;
  let instant = guess - offset;
  const corrected = wallAsUtc(wallTime(instant, timeZone)) - instant;
  if (corrected !== offset) instant = guess - corrected;
  return wallAsUtc(wallTime(instant, timeZone)) === guess ? instant : null;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function dayOfMonthMatches(field: CronField, day: number, daysInMonth: number, weekdayOf: (day: number) => number): boolean {
  for (const item of field.items) {
    switch (item.kind) {
      case "last":
        if (day === daysInMonth) return true;
        break;
      case "lastOffset":
        if (day === daysInMonth - item.offset) return true;
        break;
      case "lastWeekday": {
        let target = daysInMonth;
        while (weekdayOf(target) === 0 || weekdayOf(target) === 6) target--;
        if (day === target) return true;
        break;
      }
      case "nearestWeekday": {
        let target = Math.min(item.day, daysInMonth);
        const weekday = weekdayOf(target);
        if (weekday === 6) target = target === 1 ? 3 : target - 1;
        else if (weekday === 0) target = target === daysInMonth ? target - 2 : target + 1;
        if (day === target) return true;
        break;
      }
      default:
        break;
    }
  }
  return field.values.includes(day);
}

function dayOfWeekMatches(field: CronField, day: number, weekday: number, daysInMonth: number): boolean {
  for (const item of field.items) {
    if (item.kind === "lastDayOfWeek" && weekday === item.day && day + 7 > daysInMonth) return true;
    if (item.kind === "nthDayOfWeek" && weekday === item.day && Math.ceil(day / 7) === item.nth) return true;
  }
  return field.values.includes(weekday);
}

const DAY_MS = 86_400_000;
const SEARCH_YEARS = 30;

/**
 * Find the next `count` runs after `from`. Times follow the wall clock in `timeZone`
 * (the local zone when it is undefined). Wall times skipped by daylight saving time do not run.
 */
export function nextCronRuns(schedule: CronSchedule, from: Date, count: number, timeZone?: string): Date[] {
  const get = (name: CronFieldName) => schedule.fields.find((field) => field.name === name);
  const seconds = get("second")?.values ?? [0];
  const minutes = get("minute")!.values;
  const hours = get("hour")!.values;
  const dayOfMonth = get("dayOfMonth")!;
  const months = new Set(get("month")!.values);
  const dayOfWeek = get("dayOfWeek")!;
  const yearField = get("year");
  const years = yearField && !yearField.wildcard ? new Set(yearField.values) : null;

  const runs: Date[] = [];
  const start = wallTime(from.getTime(), timeZone);
  const lastYear = years ? Math.max(...years) : start.year + SEARCH_YEARS;
  let last = from.getTime();
  let cursor = Date.UTC(start.year, start.month - 1, start.day);
  const firstDay = cursor;

  while (runs.length < count) {
    const date = new Date(cursor);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    if (year > lastYear) break;
    if (years && !years.has(year)) {
      cursor = Date.UTC(year + 1, 0, 1);
      continue;
    }
    if (!months.has(month)) {
      cursor = Date.UTC(year, month, 1);
      continue;
    }
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const weekdayOf = (d: number) => new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    const domMatch = dayOfMonth.wildcard || dayOfMonthMatches(dayOfMonth, day, daysInMonth, weekdayOf);
    const dowMatch = dayOfWeek.wildcard || dayOfWeekMatches(dayOfWeek, day, date.getUTCDay(), daysInMonth);
    const matches = schedule.dayOr ? domMatch || dowMatch : domMatch && dowMatch;

    if (matches) {
      const today = cursor === firstDay;
      const startSeconds = start.hour * 3600 + start.minute * 60 + start.second;
      for (const hour of hours) {
        if (today && hour < start.hour) continue;
        for (const minute of minutes) {
          for (const second of seconds) {
            if (today && hour * 3600 + minute * 60 + second <= startSeconds) continue;
            const instant = wallToInstant({ year, month, day, hour, minute, second }, timeZone);
            if (instant === null || instant <= last) continue;
            runs.push(new Date(instant));
            last = instant;
            if (runs.length === count) return runs;
          }
        }
      }
    }
    cursor += DAY_MS;
  }
  return runs;
}

/** Short time until a run, such as `in 5 min` or `in 3 h 20 min`. */
export function formatTimeUntil(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return t("cron.until.seconds", { value: totalSeconds });
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return t("cron.until.minutes", { value: totalMinutes });
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) {
    const minutes = totalMinutes % 60;
    return minutes ? t("cron.until.hoursMinutes", { hours, minutes }) : t("cron.until.hours", { hours });
  }
  return t("cron.until.days", { count: Math.floor(hours / 24) });
}

/** The label of an example comes from the dictionary: `cron.example.<id>`. */
export const CRON_EXAMPLES = [
  { id: "everyMinute", expression: "* * * * *" },
  { id: "every5Minutes", expression: "*/5 * * * *" },
  { id: "workHours", expression: "*/15 9-17 * * 1-5" },
  { id: "everyHour", expression: "0 * * * *" },
  { id: "every6Hours", expression: "0 */6 * * 1-5" },
  { id: "midnight", expression: "@daily" },
  { id: "weekdays", expression: "0 9 * * MON-FRI" },
  { id: "sunday", expression: "30 3 * * SUN" },
  { id: "firstOfMonth", expression: "0 0 1 * *" },
  { id: "lastOfMonth", expression: "0 0 L * *" },
  { id: "every30Seconds", expression: "*/30 * * * * *" },
  { id: "secondMonday", expression: "0 0 9 ? * MON#2" },
] as const;
