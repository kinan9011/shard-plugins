import { describe, expect, it } from "vitest";
import en from "../src/locales/en";
import de from "../src/locales/de";
import ar from "../src/locales/ar";
import fr from "../src/locales/fr";
import es from "../src/locales/es";
import zh from "../src/locales/zh";
import ja from "../src/locales/ja";
import he from "../src/locales/he";
import { formatNumber, resolveLocale, setLocale, t } from "../src/lib/i18n";

describe("locale coverage", () => {
  for (const [name, dictionary] of Object.entries({ de, ar, fr, es, zh, ja, he })) it(`${name} has every key and placeholder`, () => {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(en)) {
      const translated = dictionary[key as keyof typeof dictionary];
      expect(translated.trim()).not.toBe("");
      expect(translated.match(/\{\w+\}/g)?.sort() ?? []).toEqual(text.match(/\{\w+\}/g)?.sort() ?? []);
    }
  });
  it("follows supported regional locales and falls back to English", () => {
    expect(resolveLocale("de-AT")).toBe("de"); expect(resolveLocale("iw")).toBe("he"); expect(resolveLocale("unknown")).toBe("en");
    setLocale("ar"); expect(t("app.title")).toBe(ar["app.title"]); expect(formatNumber(1234)).not.toMatch(/[٠-٩۰-۹]/);
    setLocale("en");
  });
});
