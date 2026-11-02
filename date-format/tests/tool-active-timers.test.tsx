import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateFormatTranslator } from "@/components/tools/DateFormatTranslator";
import { ToolActiveContext } from "@/hooks/useToolActive";

/** A tool in a background tab stays mounted; its one-second clock must not keep running. */
describe("DateFormatTranslator clock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const secondTimers = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.filter((c) => c[1] === 1000).length;

  it("does not tick in the background and starts when shown", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const view = render(<ToolActiveContext.Provider value={false}><DateFormatTranslator /></ToolActiveContext.Provider>);
    expect(secondTimers(spy)).toBe(0);
    view.rerender(<ToolActiveContext.Provider value><DateFormatTranslator /></ToolActiveContext.Provider>);
    expect(secondTimers(spy)).toBe(1);
    view.rerender(<ToolActiveContext.Provider value={false}><DateFormatTranslator /></ToolActiveContext.Provider>);
    spy.mockRestore();
  });
});
