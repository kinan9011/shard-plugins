// Worker-safe: no runtime imports from lib/i18n and no "@" alias (scripts/prepare.mjs bundles the engine worker with esbuild).
// An error carries a dictionary key and its values; the page translates it when it shows the message. The message is English, for logs and tests.
import en from "../locales/en";
import type { TKey, TVars } from "../lib/i18n";

const english = en as Record<string, string>;
export const fill = (text: string, vars?: TVars) => (vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text);

export class CodedError extends Error {
  constructor(readonly key: TKey, readonly vars?: TVars) {
    super(fill(english[key] ?? key, vars));
  }
}
