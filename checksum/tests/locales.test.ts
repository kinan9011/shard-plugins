/// <reference types="vite/client" />
// Every language of a plugin must carry every English string, so nothing silently falls back to English.
import { describe, expect, it } from "vitest";

const files = import.meta.glob<{ default: Record<string, string> }>("../src/locales/*.ts", { eager: true });
const dicts = Object.fromEntries(Object.entries(files).map(([path, mod]) => [path.match(/([a-z]+)\.ts$/)![1], mod.default]));
const LANGUAGES = ["de", "ar", "fr", "es", "zh", "ja", "he"];

const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, "");
const holes = (text: string) => new Set(text.match(/\{\w+\}/g) ?? []);
const bases = (dict: Record<string, string>) => new Set(Object.keys(dict).map(base));

describe("locales", () => {
  it("has English and the seven other languages", () => {
    expect(Object.keys(dicts).sort()).toEqual(["ar", "de", "en", "es", "fr", "he", "ja", "zh"]);
  });

  for (const lang of LANGUAGES) {
    describe(lang, () => {
      const en = dicts.en;
      const dict = dicts[lang];

      it("translates every English string and adds none", () => {
        expect([...bases(en)].filter((k) => !bases(dict).has(k))).toEqual([]);
        expect([...bases(dict)].filter((k) => !bases(en).has(k))).toEqual([]);
      });

      it("has a form for every plural family and keeps the {placeholders}", () => {
        for (const [key, text] of Object.entries(dict)) {
          const b = base(key);
          const english = Object.entries(en).filter(([k]) => base(k) === b);
          const allowed = new Set(english.flatMap(([, v]) => [...holes(v)]));
          for (const hole of holes(text)) expect(allowed, `${lang} ${key}`).toContain(hole);
          if (!key.includes("_") || b === key) {
            expect([...holes(text)].sort(), `${lang} ${key}`).toEqual([...holes(en[key] ?? "")].sort());
          }
        }
        const families = new Set(Object.keys(en).filter((k) => base(k) !== k).map(base));
        for (const f of families) expect(dict[`${f}_other`], `${lang} ${f}_other`).toBeTruthy();
      });
    });
  }
});
