import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../src/lib/i18n";
import { describeError } from "../src/pdf/describe";
import { CodedError } from "../src/pdf/errors";
import { parseRanges } from "../src/pdf/limits";

afterEach(() => setLocale("en"));

describe("describeError", () => {
  it("translates coded engine errors and the shared limit messages, and passes other errors through", () => {
    setLocale("de");
    expect(describeError(new CodedError("engine.badCrop"))).toBe("Ungültiger Seitenzuschnitt.");
    expect(() => parseRanges("1-9", 5)).toThrow("Ranges must be");
    try { parseRanges("1-9", 5); } catch (error) { expect(describeError(error)).toContain("zwischen 1 und 5"); }
    expect(describeError(new Error("third-party text"))).toBe("third-party text");
    setLocale("en");
    expect(describeError(new CodedError("engine.badCrop"))).toBe("Invalid page crop.");
  });
});
