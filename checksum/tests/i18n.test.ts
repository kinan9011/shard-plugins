import { afterEach, describe, expect, it, vi } from "vitest";
import { codeDir, followHostLocale, formatNumber, getLocale, intlTag, lookup, resolveLocale, setLocale, t, type TKey } from "../src/lib/i18n";

afterEach(() => {
  setLocale("en");
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
  window.history.replaceState(null, "", "/");
});

describe("resolveLocale", () => {
  it("maps the app's tags to a language the plugin has, and anything else to English", () => {
    expect(resolveLocale("zh-CN")).toBe("zh");
    expect(resolveLocale("de-AT")).toBe("de");
    expect(resolveLocale("iw")).toBe("he");
    expect(resolveLocale("AR")).toBe("ar");
    expect(resolveLocale("pt-BR")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });
});

describe("t", () => {
  it("translates, and falls back to English for an unknown language and to the key for an unknown key", () => {
    setLocale("de");
    expect(t("common.copy")).toBe("Kopieren");
    setLocale("pt");
    expect(getLocale()).toBe("en");
    expect(t("common.copy")).toBe("Copy");
    expect(t("no.such.key" as TKey)).toBe("no.such.key");
  });
});

describe("lookup", () => {
  it("picks the plural form of the language and falls back to _other, then to the plain key", () => {
    const ar = { k_zero: "zero", k_one: "one", k_two: "two", k_few: "few", k_many: "many", k_other: "other" };
    expect([0, 1, 2, 3, 11, 100].map((n) => lookup(ar, "ar", "k", n))).toEqual(["zero", "one", "two", "few", "many", "other"]);
    expect(lookup({ k_other: "files" }, "ja", "k", 1)).toBe("files");
    expect(lookup({ k: "plain" }, "en", "k", 5)).toBe("plain");
    expect(lookup({}, "en", "k", undefined)).toBeUndefined();
  });
});

describe("formatNumber", () => {
  it("keeps Latin digits in Arabic", () => {
    setLocale("ar");
    expect(formatNumber(1234.5)).toBe("1,234.5");
    expect(formatNumber(12345678901234567890n)).toBe("12,345,678,901,234,567,890");
    expect(intlTag()).toBe("ar-u-nu-latn");
  });

  it("gives the same text on a repeated call (cached formatters)", () => {
    expect(formatNumber(1.5, { minimumFractionDigits: 2 })).toBe("1.50");
    expect(formatNumber(1.5, { minimumFractionDigits: 2 })).toBe("1.50");
    expect(formatNumber(1.5)).toBe("1.5");
  });
});

describe("codeDir", () => {
  it("keeps typed code left-to-right and lets an empty field follow the page", () => {
    expect(codeDir('["مرحبا"]')).toBe("ltr");
    expect(codeDir("")).toBeUndefined();
    expect(codeDir(undefined)).toBeUndefined();
  });
});

describe("followHostLocale", () => {
  const sdkWith = (locale: unknown) => {
    let push: (l: { lang: string; dir: "ltr" | "rtl" }) => void = () => {};
    const sdk = {
      ready: vi.fn(async () => ({ pluginId: "x", theme: {}, visible: true, locale })),
      locale: { get: vi.fn(), onChange: (cb: typeof push) => ((push = cb), () => {}) },
    };
    return { sdk: sdk as never, push: (l: Parameters<typeof push>[0]) => push(l) };
  };

  it("applies the app language and direction to <html>, then follows changes", async () => {
    const { sdk, push } = sdkWith({ lang: "ar", dir: "rtl" });
    await followHostLocale(sdk);
    expect(getLocale()).toBe("ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    push({ lang: "zh-CN", dir: "ltr" });
    expect(getLocale()).toBe("zh");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("shows English, left-to-right, when the app language is one the plugin does not have", async () => {
    const { sdk } = sdkWith({ lang: "fa", dir: "rtl" });
    await followHostLocale(sdk);
    expect(getLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("stays in English when an older app sends no locale", async () => {
    await followHostLocale(sdkWith(undefined).sdk);
    expect(getLocale()).toBe("en");
  });

  it("takes ?lang= instead of the app, for development", async () => {
    window.history.replaceState(null, "", "/?lang=he");
    const { sdk } = sdkWith({ lang: "de", dir: "ltr" });
    await followHostLocale(sdk);
    expect(getLocale()).toBe("he");
    expect(document.documentElement.dir).toBe("rtl");
  });
});
