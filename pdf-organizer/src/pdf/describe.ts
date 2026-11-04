import { t, type TVars } from "@/lib/i18n";
import { CodedError } from "./errors";

/** The message of an error in the current language. Call it when the message is shown, not when the error is created. */
export function describeError(error: unknown): string {
  if (error instanceof CodedError) {
    const vars = error.vars && (Object.fromEntries(Object.entries(error.vars).map(([name, value]) => [name, value instanceof Error ? describeError(value) : value])) as TVars);
    return t(error.key, vars);
  }
  if (!(error instanceof Error)) return t("error.generic");
  return error.message;
}
