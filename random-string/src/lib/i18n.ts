// Follows the app language. Relative imports, so it works in the flat plugins (no @/ alias) too. No library: a plugin ships its own dictionaries in src/locales/<id>.ts and this file picks one.
// English is the fallback for a missing key and for any language the plugin does not have. Mirrors the app's src/i18n/index.ts.
import { useMemo, useSyncExternalStore } from "react";
import type { Locale, ShardSdk } from "../shard-sdk";
import { common, en as commonEn } from "./i18n-common";
// ponytail: eager imports, no English flash and no async load. Lazy-load per language if a plugin's bundle ever gets too big.
import en from "../locales/en";
import de from "../locales/de";
import ar from "../locales/ar";
import fr from "../locales/fr";
import es from "../locales/es";
import zh from "../locales/zh";
import ja from "../locales/ja";
import he from "../locales/he";

export type LocaleId = "en" | "de" | "ar" | "fr" | "es" | "zh" | "ja" | "he";
type Dict = Record<string, string>;

/** `tag` is what Intl gets; the app sends Chinese as "zh-CN". */
export const LOCALES: Record<LocaleId, { tag: string; dir: "ltr" | "rtl" }> = {
  en: { tag: "en", dir: "ltr" },
  de: { tag: "de", dir: "ltr" },
  ar: { tag: "ar", dir: "rtl" },
  fr: { tag: "fr", dir: "ltr" },
  es: { tag: "es", dir: "ltr" },
  zh: { tag: "zh-CN", dir: "ltr" },
  ja: { tag: "ja", dir: "ltr" },
  he: { tag: "he", dir: "rtl" },
};

const own: Record<LocaleId, Dict> = { en, de, ar, fr, es, zh, ja, he };
const dictionaries = Object.fromEntries((Object.keys(own) as LocaleId[]).map((id) => [id, { ...common[id], ...own[id] }])) as Record<LocaleId, Dict>;

type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";
type Base<K extends string> = K extends `${infer B}_${PluralSuffix}` ? B : K;
/** Every key of the plugin's English dictionary and the shared one; plural families by their base name. */
export type TKey = Base<Extract<keyof typeof en | keyof typeof commonEn, string>>;
export type TVars = Record<string, string | number>;

/** "zh-CN" -> "zh", "de-AT" -> "de", "iw" -> "he"; anything the plugin does not have -> "en". */
export function resolveLocale(tag: string | undefined | null): LocaleId {
  const primary = String(tag ?? "").toLowerCase().split(/[-_]/)[0];
  const id = primary === "iw" ? "he" : primary;
  return id in LOCALES ? (id as LocaleId) : "en";
}

let current: LocaleId = "en";
const listeners = new Set<() => void>();

export const getLocale = () => current;
export const getDir = () => LOCALES[current].dir;

export function setLocale(tag: string | undefined | null): void {
  const next = resolveLocale(tag);
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

/** One entry of a dictionary; with `count`, the plural form of the language (`key_one`, `key_other`, ...), else the plain key. */
export function lookup(dict: Dict, tag: string, key: string, count: number | undefined): string | undefined {
  if (count !== undefined) {
    const category = new Intl.PluralRules(tag).select(count);
    return dict[`${key}_${category}`] ?? dict[`${key}_other`] ?? dict[key];
  }
  return dict[key];
}

/** Translates `key`, filling `{name}` from `vars`. `vars.count` picks the plural form. Falls back to English, then to the key. */
export function t(key: TKey, vars?: TVars): string {
  const count = typeof vars?.count === "number" ? vars.count : undefined;
  const text = lookup(dictionaries[current], LOCALES[current].tag, key, count) ?? lookup(dictionaries.en, "en", key, count) ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * `t`, and a re-render of the component when the app language changes. Call it in every component that shows text.
 * The function is new for each language, so a `useMemo`/`useCallback` that builds text lists `t` in its deps and refreshes with the language.
 */
export function useT(): typeof t {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (key: TKey, vars?: TVars) => t(key, vars), [locale]);
}

/** The current language and direction, re-rendering on change. */
export function useLocale(): { locale: LocaleId; dir: "ltr" | "rtl" } {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, dir: LOCALES[locale].dir };
}

// A dev tool shows Latin digits in every language, so numbers read the same as in the code beside them.
const numberTag = () => `${LOCALES[current].tag}-u-nu-latn`;
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(numberTag(), options).format(value);
export const formatDate = (value: Date | number, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(numberTag(), options).format(value);

/** Comma/and lists in the current language, e.g. "A, B, and C". */
export const formatList = (items: string[], type: Intl.ListFormatOptions["type"] = "conjunction") => new Intl.ListFormat(LOCALES[current].tag, { type }).format(items);

function apply(locale: Locale | undefined) {
  if (!locale || typeof locale.lang !== "string") return;
  setLocale(locale.lang);
  const root = document.documentElement;
  root.lang = locale.lang;
  root.dir = locale.dir === "rtl" || locale.dir === "ltr" ? locale.dir : getDir();
}

/**
 * Takes the language from the app, now and on every change, and sets `lang` and `dir` on <html> (the app does not do that for plugin frames).
 * Resolves once the first answer arrived, or after 300 ms when there is no app (npm run dev), so the first paint is in the right language.
 * `?lang=de` in the URL picks a language by hand for development; the app never adds a query.
 */
export async function followHostLocale(sdk: Pick<ShardSdk, "ready" | "locale">): Promise<void> {
  const forced = new URLSearchParams(location.search).get("lang");
  if (forced) {
    const id = resolveLocale(forced);
    apply({ lang: LOCALES[id].tag, dir: LOCALES[id].dir });
    return;
  }
  sdk.locale.onChange(apply);
  const first = sdk
    .ready()
    .then((info) => apply(info.locale)) // an older app sends no locale: stay in English
    .catch(() => {});
  await Promise.race([first, new Promise((resolve) => setTimeout(resolve, 300))]);
}

/**
 * `dir` for a text field: typed text follows its own direction (`auto`), an empty field follows the page, so its placeholder
 * lines up with the rest of the right-to-left layout. Pass the field's `value` (or `defaultValue`).
 */
export const autoDir = (value: unknown): "auto" | undefined => (value === undefined || value === null || value === "" ? undefined : "auto");
