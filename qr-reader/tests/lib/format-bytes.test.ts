import { describe, expect, it } from "vitest";
import { formatBytes } from "@/utils/format-bytes";

describe("formatBytes", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(2048)).toBe("2.00 KB");
    expect(formatBytes(15 * 1024)).toBe("15.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.00 GB");
  });
});
