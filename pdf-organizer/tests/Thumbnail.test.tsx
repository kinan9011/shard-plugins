import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Thumbnail } from "../src/Thumbnail";
import { ToolActiveContext } from "../src/hooks/useToolActive";
import { previewDocument } from "../src/pdf/preview";
import type { Page, Source } from "../src/pdf/engine";

vi.mock("../src/pdf/preview", () => ({ previewDocument: vi.fn() }));
const source: Source = { id: "source", name: "sample.pdf", bytes: new Uint8Array(), count: 2, report: { forms: 0, annotations: 0, signatures: false, outlines: false } };
const page: Page = { id: "page", sourceId: source.id, index: 0, rotation: 0 };
let intersect: (near: boolean) => void;
let tasks: { promise: Promise<void>; cancel: ReturnType<typeof vi.fn>; resolve: () => void; reject: (error: Error) => void }[];
let renderPage: ReturnType<typeof vi.fn>;
let getPage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { intersect = near => callback([{ isIntersecting: near }]); }
    observe() {} disconnect() {}
  });
  tasks = [];
  renderPage = vi.fn(() => {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const task = { promise, cancel: vi.fn(() => reject(new Error("Rendering cancelled"))), resolve, reject };
    tasks.push(task); return task;
  });
  getPage = vi.fn(async () => ({
    rotate: 90,
    getViewport: ({ scale, rotation }: { scale: number; rotation: number }) => ({ width: (rotation % 180 ? 480 : 320) * scale, height: (rotation % 180 ? 320 : 480) * scale }),
    render: renderPage,
  }));
  vi.mocked(previewDocument).mockReset().mockResolvedValue({ getPage } as never);
});
afterEach(() => vi.unstubAllGlobals());

describe("PDF preview rendering", () => {
  it("stays lazy, renders at the box size and DPR, and keeps the pixel budget", async () => {
    const view = render(<Thumbnail source={source} page={page} size={200} />);
    expect(previewDocument).not.toHaveBeenCalled();
    act(() => intersect(true));
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    const first = screen.getByRole("img") as HTMLCanvasElement;
    // Rotated 480x320 page fitted into a 200 x 282 box.
    expect(first).toHaveAttribute("width", "200"); expect(first.style.width).toBe("100%");
    vi.stubGlobal("devicePixelRatio", 2); fireEvent(window, new Event("resize"));
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("img")).toHaveAttribute("width", "400");
    expect(tasks[0].cancel).toHaveBeenCalledOnce();
    expect(screen.getByRole("img")).not.toBe(first);
    expect(first).toHaveAttribute("width", "0");
    view.rerender(<Thumbnail source={source} page={page} size={1600} />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(3));
    const big = screen.getByRole("img") as HTMLCanvasElement;
    expect(big.width).toBeGreaterThan(1600);
    expect(big.width * big.height).toBeLessThanOrEqual(4_000_000);
  });

  it("re-renders once after the size settles instead of on every slider step", async () => {
    const view = render(<Thumbnail source={source} page={page} size={200} />);
    act(() => intersect(true)); await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    view.rerender(<Thumbnail source={source} page={page} size={240} />);
    view.rerender(<Thumbnail source={source} page={page} size={280} />);
    expect(view.container.querySelector<HTMLElement>(".thumbnail")).toHaveStyle({ width: "280px", height: "395px" });
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(renderPage).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("img")).toHaveAttribute("width", "280");
  });

  it("cancels obsolete work and ignores stale failures during page, size and rotation changes", async () => {
    const view = render(<Thumbnail source={source} page={page} size={200} />);
    act(() => intersect(true)); await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    view.rerender(<Thumbnail source={source} page={{ ...page, index: 1, rotation: 90 }} size={100} />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
    expect(tasks[0].cancel).toHaveBeenCalledOnce(); expect(getPage).toHaveBeenLastCalledWith(2);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "sample.pdf, original page 2");
    expect(screen.queryByText(/Preview unavailable/)).not.toBeInTheDocument();
    await act(async () => { tasks[1].reject(new Error("Unsupported encoding")); });
    expect(screen.getByRole("status")).toHaveTextContent("Preview unavailable: Unsupported encoding");
  });

  it("releases work and canvas buffers when hidden, offscreen or unmounted and resumes lazily", async () => {
    const content = (active: boolean) => <ToolActiveContext.Provider value={active}><Thumbnail source={source} page={page} size={200} /></ToolActiveContext.Provider>;
    const view = render(content(true));
    act(() => intersect(true)); await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    const canvas = screen.getByRole("img");
    view.rerender(content(false));
    await waitFor(() => expect(canvas).toHaveAttribute("width", "0"));
    expect(tasks[0].cancel).toHaveBeenCalledOnce(); expect(screen.queryByRole("img")).not.toBeInTheDocument();
    view.rerender(content(true)); await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
    act(() => intersect(false)); expect(tasks[1].cancel).toHaveBeenCalledOnce();
    act(() => intersect(true)); await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(3));
    view.unmount(); expect(tasks[2].cancel).toHaveBeenCalledOnce();
  });

  it("does not request an obsolete page after a delayed document load", async () => {
    let complete!: (value: never) => void;
    vi.mocked(previewDocument).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const view = render(<Thumbnail source={source} page={page} size={200} />);
    act(() => intersect(true));
    view.rerender(<Thumbnail source={source} page={{ ...page, index: 1 }} size={300} />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    await act(async () => { complete({ getPage } as never); });
    expect(getPage).toHaveBeenCalledOnce(); expect(getPage).toHaveBeenCalledWith(2);
    expect(renderPage).toHaveBeenCalledOnce();
  });
});
