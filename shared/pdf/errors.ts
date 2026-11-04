// Worker-safe: no runtime imports from lib/i18n and no "@" alias (scripts/prepare.mjs bundles the engine worker with esbuild).
// An error carries a dictionary key and its values; the page translates it when it shows the message. The message is English, for logs and tests.
// A value may itself be an error (a failed file inside "{name}: {message}"); the page describes it in the same language.
import en from "../locales/en";
import type { TKey } from "../lib/i18n";

const english = en as Record<string, string>;
export type ErrorVars = Record<string, string | number | Error>;
export const fill = (text: string, vars?: ErrorVars) =>
  vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? (vars[name] instanceof Error ? (vars[name] as Error).message : String(vars[name])) : whole)) : text;

export class CodedError extends Error {
  constructor(readonly key: TKey, readonly vars?: ErrorVars) {
    super(fill(english[key] ?? key, vars));
  }
}
