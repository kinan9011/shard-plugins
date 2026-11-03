import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { sdk } from "../src/sdk";
import { prepareInput, runEngine } from "../src/pdf/client";
import { contentBounds, pageSize } from "../src/pdf/preview";
import { ToolActiveContext } from "../src/hooks/useToolActive";

vi.mock("../src/Thumbnail", async () => {
  const { createContext } = await import("react");
  return { ScrollRoot: createContext(null), Thumbnail: ({ page, size }: { page: { id: string }; size: number }) => <span data-testid="thumbnail" data-preview-page={page.id} data-size={size} /> };
});
vi.mock("../src/pdf/preview", () => ({ clearPreviews: vi.fn(), contentBounds: vi.fn(), pageSize: vi.fn() }));
vi.mock("../src/pdf/client", () => ({ prepareInput: vi.fn(), runEngine: vi.fn() }));

const report = { forms: 0, outlines: false, signatures: false, annotations: 0 };
const bytes = new Uint8Array([37, 80, 68, 70]);
let fileName: string;
beforeEach(() => {
  fileName = "sample.pdf";
  vi.mocked(prepareInput).mockReset().mockResolvedValue({ bytes, count: 3, report });
  vi.mocked(runEngine).mockReset().mockResolvedValue({ bytes, extension: "pdf" });
  vi.mocked(sdk.files.open).mockReset().mockImplementation(async () => ({ name: fileName, size: bytes.length, bytes }));
  vi.mocked(sdk.files.save).mockReset().mockResolvedValue(true);
  vi.mocked(contentBounds).mockReset().mockResolvedValue([0.1, 0.2, 0.1, 0.2]);
  vi.mocked(pageSize).mockReset().mockResolvedValue([300, 400]);
});

const page = (number: number) => screen.getByRole("row", { name: `Page ${number}` });
const rows = () => screen.getAllByRole("row");
const order = () => rows().map(row => row.dataset.pageId!);
const selectedNumbers = () => rows().flatMap((row, index) => row.getAttribute("aria-selected") === "true" ? [index + 1] : []);
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const key = (init: KeyboardEventInit, target: Element | Window = window) => fireEvent.keyDown(target, init);
const ctrl = (letter: string, extra: KeyboardEventInit = {}) => key({ key: letter, ctrlKey: true, ...extra });
const menuItem = (name: RegExp) => screen.getByRole("menuitem", { name });

async function openFile(count = 3, name = "sample.pdf") {
  fileName = name;
  vi.mocked(prepareInput).mockResolvedValueOnce({ bytes, count, report });
  click(screen.queryByRole("button", { name: "Open PDF" }) ? "Open PDF" : "Open");
  if (screen.queryByRole("button", { name: "Choose file…" })) click("Choose file…");
  await screen.findByRole("row", { name: "Page 1" });
}

async function importFile(count: number, name: string) {
  fileName = name;
  vi.mocked(prepareInput).mockResolvedValueOnce({ bytes, count, report });
  click("Import");
  await waitFor(() => expect(screen.getByRole("button", { name: "Import" })).toBeEnabled());
}

/** Saves through Ctrl+S and returns the exported page order as "file:page". */
async function exported() {
  vi.mocked(runEngine).mockClear();
  ctrl("s");
  const confirm = screen.queryByRole("button", { name: "I understand, save" });
  if (confirm) fireEvent.click(confirm);
  await waitFor(() => expect(runEngine).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  const request = vi.mocked(runEngine).mock.calls[0][0] as { sources: { id: string; name: string }[]; pages: { sourceId: string; index: number; rotation: number }[]; groups: number[][] };
  return { request, names: request.groups[0].map(i => `${request.sources.find(s => s.id === request.pages[i].sourceId)!.name}:${request.pages[i].index + 1}`) };
}

describe("shell", () => {
  it("starts with one upload action, then shows only the toolbar, grid and status", async () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Open PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument(); expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    await openFile(3);
    expect(screen.getByRole("toolbar", { name: "Page tools" })).toBeInTheDocument();
    expect(rows()).toHaveLength(3); expect(screen.getByText("3 pages · 0 selected")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    for (const name of ["Rotate left", "Rotate right", "Delete"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("keeps the session on cancelled pickers, failed files and busy state", async () => {
    render(<App />); await openFile(3);
    vi.mocked(sdk.files.open).mockResolvedValueOnce(null);
    click("Import"); await screen.findByText("No file selected. Your pages are unchanged.");
    vi.mocked(prepareInput).mockRejectedValueOnce(new Error("This PDF could not be read."));
    click("Import"); await screen.findByText("sample.pdf: This PDF could not be read.");
    expect(rows()).toHaveLength(3);
    let finish!: (value: null) => void;
    vi.mocked(sdk.files.open).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    click("Import"); expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    click("Cancel processing"); finish(null); await screen.findByText("Cancelled. Your pages are unchanged.");
    expect(rows()).toHaveLength(3);
  });

  it("zoom changes only the thumbnail size, never history", async () => {
    render(<App />); await openFile();
    expect(screen.getAllByTestId("thumbnail")[0]).toHaveAttribute("data-size", "160");
    click("Zoom in"); key({ key: "+" });
    expect(screen.getAllByTestId("thumbnail")[0]).toHaveAttribute("data-size", "192");
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), { target: { value: "400" } });
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    key({ key: "0" }); expect(screen.getAllByTestId("thumbnail")[0]).toHaveAttribute("data-size", "160");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});

describe("selection", () => {
  it("click, Ctrl toggle and Shift range work by displayed order; the menu offers odd, even and invert", async () => {
    render(<App />); await openFile(5);
    fireEvent.click(page(2)); expect(selectedNumbers()).toEqual([2]);
    fireEvent.click(page(4), { ctrlKey: true }); expect(selectedNumbers()).toEqual([2, 4]);
    fireEvent.click(page(5), { shiftKey: true }); expect(selectedNumbers()).toEqual([4, 5]);
    fireEvent.click(page(1), { ctrlKey: true, shiftKey: true }); expect(selectedNumbers()).toEqual([1, 2, 3, 4, 5]);
    ctrl("a", { shiftKey: true }); expect(selectedNumbers()).toEqual([]);
    const pick = (name: RegExp) => { click("More actions"); fireEvent.click(menuItem(name)); };
    pick(/^Select odd pages/); expect(selectedNumbers()).toEqual([1, 3, 5]);
    pick(/^Select even pages/); expect(selectedNumbers()).toEqual([2, 4]);
    pick(/^Invert selection/); expect(selectedNumbers()).toEqual([1, 3, 5]);
    ctrl("a"); expect(selectedNumbers()).toEqual([1, 2, 3, 4, 5]); expect(screen.getByText("5 pages · 5 selected")).toBeInTheDocument();
  });

  it("marquee selects from the background only, past a threshold, and Escape restores", async () => {
    render(<App />); await openFile(5);
    const grid = screen.getByRole("grid");
    Object.assign(grid, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
    layout(5);
    const point = (target: HTMLElement, type: string, x: number, y: number, ctrlKey = false) => pointer(target, type, x, y, { ctrlKey });
    fireEvent.click(page(5));
    point(grid, "pointerdown", 5, 5); point(grid, "pointermove", 7, 7); expect(selectedNumbers()).toEqual([5]);
    point(grid, "pointermove", 400, 150); expect(selectedNumbers()).toEqual([1, 2]);
    key({ key: "Escape" }); expect(selectedNumbers()).toEqual([5]);
    point(grid, "pointerdown", 5, 5, true); point(grid, "pointermove", 220, 150); point(grid, "pointerup", 220, 150);
    expect(selectedNumbers()).toEqual([1, 5]);
    point(grid, "pointerdown", 5, 5); point(grid, "pointerup", 5, 5); expect(selectedNumbers()).toEqual([]);
  });
});

describe("page actions", () => {
  it("rotate, delete, undo and redo act on exactly the selected pages", async () => {
    render(<App />); await openFile(5);
    fireEvent.click(page(2)); fireEvent.click(page(4), { ctrlKey: true });
    click("Rotate right"); ctrl("ArrowRight"); click("Rotate left");
    let { request } = await exported();
    expect(request.pages.map(p => p.rotation)).toEqual([0, 90, 0, 90, 0]);
    ctrl("ArrowLeft"); ({ request } = await exported());
    expect(request.pages.map(p => p.rotation)).toEqual([0, 0, 0, 0, 0]);
    const before = order();
    key({ key: "Delete" }); expect(order()).toEqual([before[0], before[2], before[4]]);
    expect(screen.getByText(/Deleted 2 pages/)).toBeInTheDocument();
    ctrl("z"); expect(order()).toEqual(before); expect(selectedNumbers()).toEqual([]);   // restored IDs are not re-selected
    ctrl("y"); expect(rows()).toHaveLength(3);
    ctrl("z", { shiftKey: true }); expect(rows()).toHaveLength(3);
    ctrl("z"); expect(rows()).toHaveLength(5);
  });

  it("returns to an empty drop zone when every page is deleted and undo restores them", async () => {
    render(<App />); await openFile(2);
    ctrl("a"); click("Delete");
    expect(await screen.findByText("No pages left")).toBeInTheDocument(); expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    click("Undo"); expect(rows()).toHaveLength(2);
  });

  it("copy, cut, paste, duplicate and reverse clone pages with fresh IDs in one edit each", async () => {
    render(<App />); await openFile(4);
    const first = order();
    fireEvent.click(page(1)); ctrl("c"); fireEvent.click(page(3)); ctrl("v");
    expect(rows()).toHaveLength(5); expect(selectedNumbers()).toEqual([4]);
    expect(order().slice(0, 3)).toEqual(first.slice(0, 3)); expect(first).not.toContain(order()[3]);
    ctrl("z"); expect(order()).toEqual(first);
    fireEvent.click(page(2)); ctrl("x"); expect(order()).toEqual([first[0], first[2], first[3]]);
    fireEvent.click(page(3)); ctrl("v"); expect(rows()).toHaveLength(4);
    ctrl("z"); ctrl("z"); expect(order()).toEqual(first);
    fireEvent.click(page(2)); ctrl("d"); expect(rows()).toHaveLength(5); expect(selectedNumbers()).toEqual([2]);
    ctrl("z"); ctrl("a"); click("More actions"); fireEvent.click(menuItem(/^Reverse selected order/));
    expect(order()).toEqual([...first].reverse());
  });

  it("moves a scattered group, even touching both ends, with Alt+arrows and the menu", async () => {
    render(<App />); await openFile(5);
    const original = order();
    fireEvent.click(page(1)); fireEvent.click(page(3), { ctrlKey: true }); fireEvent.click(page(5), { ctrlKey: true });
    key({ key: "ArrowLeft", altKey: true });
    expect(order()).toEqual([original[0], original[2], original[4], original[1], original[3]]); expect(selectedNumbers()).toEqual([1, 2, 3]);
    key({ key: "ArrowLeft", altKey: true }); expect(order()).toEqual([original[0], original[2], original[4], original[1], original[3]]);
    ctrl("z"); key({ key: "ArrowRight", altKey: true });
    expect(order()).toEqual([original[1], original[3], original[0], original[2], original[4]]); expect(selectedNumbers()).toEqual([3, 4, 5]);
    ctrl("z"); expect(order()).toEqual(original);
  });

  it("ignores page shortcuts while typing, in menus or dialogs, and in an inactive tool", async () => {
    const view = (active: boolean) => <ToolActiveContext.Provider value={active}><App /><input aria-label="Other" /></ToolActiveContext.Provider>;
    const { rerender } = render(view(true)); await openFile(3);
    fireEvent.click(page(1));
    key({ key: "Delete" }, screen.getByLabelText("Other")); expect(rows()).toHaveLength(3);
    rerender(view(false)); key({ key: "Delete" }); expect(rows()).toHaveLength(3);
    rerender(view(true)); key({ key: "?" }); expect(screen.getByRole("dialog", { name: "Shortcuts and gestures" })).toBeInTheDocument();
    key({ key: "Delete" }); expect(rows()).toHaveLength(3);
    click("Close"); key({ key: "Delete" }); expect(rows()).toHaveLength(2);
  });
});

describe("menus", () => {
  it("right-click selects an unselected page, opens page actions and runs one", async () => {
    render(<App />); await openFile(3);
    fireEvent.click(page(1)); fireEvent.contextMenu(page(3), { clientX: 50, clientY: 60 });
    expect(selectedNumbers()).toEqual([3]);
    const menu = screen.getByRole("menu", { name: "Page actions" });
    for (const name of [/^Cut/, /^Copy/, /^Duplicate/, /^Delete/, /^Rotate left/, /^Rotate right/, /^Export pages/]) expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /^Paste after/ })).toBeDisabled();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Delete/ }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(); expect(rows()).toHaveLength(2);
  });

  it("keeps a multi-selection when right-clicking inside it; background menu offers paste, import and select all", async () => {
    render(<App />); await openFile(4);
    fireEvent.click(page(1)); fireEvent.click(page(3), { ctrlKey: true });
    fireEvent.contextMenu(page(3)); expect(selectedNumbers()).toEqual([1, 3]);
    key({ key: "Escape" }, screen.getByRole("menuitem", { name: /^Cut/ })); expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(selectedNumbers()).toEqual([1, 3]);
    fireEvent.contextMenu(screen.getByRole("grid"));
    const menu = screen.getByRole("menu"); expect(within(menu).getAllByRole("menuitem").map(item => item.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/^Select all/)]));
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Select all/ })); expect(selectedNumbers()).toEqual([1, 2, 3, 4]);
  });

  it("opens the page menu from the keyboard and navigates with arrows", async () => {
    render(<App />); await openFile(3);
    const cell = screen.getByRole("gridcell", { name: "Select page 2" });
    fireEvent.click(page(2)); cell.focus(); key({ key: "F10", shiftKey: true }, cell);
    const items = screen.getAllByRole("menuitem").filter(item => !(item as HTMLButtonElement).disabled);
    expect(items[0]).toHaveFocus();
    key({ key: "ArrowDown" }, items[0]); expect(items[1]).toHaveFocus();
    key({ key: "End" }, items[1]); expect(items[items.length - 1]).toHaveFocus();
  });
});

function layout(count: number) {
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) });
  vi.spyOn(screen.getByRole("grid"), "getBoundingClientRect").mockReturnValue(rect(0, 0, 660, 640));
  vi.spyOn(document.querySelector(".grid-scroll")!, "getBoundingClientRect").mockReturnValue(rect(0, 0, 660, 640));
  rows().slice(0, count).forEach((row, index) => vi.spyOn(row, "getBoundingClientRect").mockReturnValue(rect(20 + index % 3 * 210, 20 + Math.floor(index / 3) * 310, 190, 290)));
}
function pointer(target: Element | Window, type: string, x: number, y: number, extra: MouseEventInit & { pointerType?: string; pointerId?: number } = {}) {
  const { pointerType = "mouse", pointerId = 1, ...init } = extra;
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...init });
  Object.assign(event, { pointerId, isPrimary: true, pointerType });
  fireEvent(target, event);
}

describe("pointer reordering", () => {
  beforeEach(() => vi.mocked(prepareInput).mockResolvedValue({ bytes, count: 5, report }));
  const drag = (from: number, x: number, y: number, extra: MouseEventInit = {}) => {
    pointer(page(from), "pointerdown", 30, 30); pointer(page(from), "pointermove", 40, 40);
    pointer(window, "pointermove", x, y, extra); pointer(window, "pointerup", x, y, extra);
  };

  it("drags a nonadjacent group as one block across rows in one undoable edit", async () => {
    render(<App />); await openFile(5); layout(5);
    const original = order();
    fireEvent.click(page(2)); fireEvent.click(page(4), { ctrlKey: true });
    pointer(page(2), "pointerdown", 230, 30); pointer(window, "pointermove", 240, 40);
    expect(document.querySelector(".drag-ghost")).toHaveTextContent("2 pages");
    pointer(window, "pointermove", 640, 400);   // right half of page 5 (second row, third column is empty)
    expect(document.querySelector(".page-insertion-marker")).not.toBeNull();
    pointer(window, "pointerup", 640, 400);
    expect(order()).toEqual([original[0], original[2], original[4], original[1], original[3]]);
    expect(selectedNumbers()).toEqual([4, 5]); expect(document.querySelector(".drag-ghost")).toBeNull();
    click("Undo"); expect(order()).toEqual(original);
  });

  it("selects and moves only an unselected dragged page; the click after a drag does not reselect", async () => {
    render(<App />); await openFile(5); layout(5);
    const original = order();
    fireEvent.click(page(5)); drag(1, 20, 20);   // left half of page 1: before it, no-op
    expect(order()).toEqual(original); expect(selectedNumbers()).toEqual([1]);
    drag(1, 440, 100);                            // left half of page 3
    expect(order()).toEqual([original[1], original[0], original[2], original[3], original[4]]); layout(5);
    await new Promise(resolve => setTimeout(resolve, 5));   // a real click arrives after the drag's own click was swallowed
    fireEvent.click(page(2)); expect(selectedNumbers()).toEqual([2]);
    fireEvent.click(page(3), { ctrlKey: true });
    pointer(page(2), "pointerdown", 230, 30); pointer(window, "pointermove", 240, 60); pointer(window, "pointermove", 20, 20); pointer(window, "pointerup", 20, 20);
    expect(order().slice(0, 2)).toEqual([original[0], original[2]]);
    fireEvent.click(page(1)); expect(selectedNumbers()).toEqual([1, 2]);   // suppressed: selection kept
  });

  it("Ctrl at drop copies; outside drops, Escape, busy and no-op targets change nothing", async () => {
    render(<App />); await openFile(3); layout(3);
    const original = order();
    fireEvent.click(page(1)); drag(1, 640, 100, { ctrlKey: true });
    expect(rows()).toHaveLength(4); expect(order().slice(0, 3)).toEqual(original); expect(selectedNumbers()).toEqual([4]);
    click("Undo"); layout(3);
    pointer(page(1), "pointerdown", 30, 30); pointer(window, "pointermove", 40, 40); pointer(window, "pointermove", 640, 100);
    key({ key: "Escape" }); pointer(window, "pointerup", 640, 100); expect(order()).toEqual(original);
    drag(1, 900, 900); expect(order()).toEqual(original);                      // outside the scroll area
    fireEvent.click(page(2)); drag(2, 250, 100); expect(order()).toEqual(original);   // onto itself
    pointer(page(1), "pointerdown", 30, 30); pointer(window, "pointermove", 40, 40);
    pointer(window, "pointercancel", 40, 40); expect(document.querySelector(".drag-ghost")).toBeNull();
    pointer(page(1), "pointerdown", 30, 30, { button: 2 }); pointer(window, "pointermove", 40, 40); expect(document.querySelector(".drag-ghost")).toBeNull();
  });

  it("drags by long-press on touch and scrolls when the finger moves first", async () => {
    vi.useFakeTimers();
    try {
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      layout(5);
      pointer(page(1), "pointerdown", 30, 30, { pointerType: "touch" }); pointer(window, "pointermove", 60, 60, { pointerType: "touch" });
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(document.querySelector(".drag-ghost")).toBeNull();
      pointer(page(1), "pointerdown", 30, 30, { pointerType: "touch" });
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(document.querySelector(".drag-ghost")).not.toBeNull();
      pointer(window, "pointerup", 30, 30, { pointerType: "touch" });
    } finally { vi.useRealTimers(); }
  });
});

describe("importing", () => {
  it("inserts after the focused selected page, appends without a selection, and one undo reverts the batch", async () => {
    render(<App />); await openFile(3, "ABC.pdf");
    fireEvent.click(page(2));
    expect(screen.getByRole("button", { name: "Import" })).toHaveAttribute("title", "Import after page 2 (Ctrl+I)");
    await importFile(2, "XY.pdf");
    expect((await exported()).names).toEqual(["ABC.pdf:1", "ABC.pdf:2", "XY.pdf:1", "XY.pdf:2", "ABC.pdf:3"]);
    ctrl("a", { shiftKey: true }); await importFile(1, "Z.pdf");
    expect((await exported()).names.slice(-1)).toEqual(["Z.pdf:1"]);
    click("Undo"); click("Undo"); expect(rows()).toHaveLength(3);
  });

  it("an explicit file drop target beats the selection; background drops append; extras reset the warning", async () => {
    render(<App />); await openFile(3, "ABC.pdf");
    fireEvent.click(page(3));
    const files = [{ name: "XY.pdf", size: 4, arrayBuffer: async () => bytes.buffer }];
    const drop = (target: Element) => fireEvent.drop(target, { dataTransfer: { types: ["Files"], files } });
    vi.mocked(prepareInput).mockResolvedValueOnce({ bytes, count: 2, report });
    fireEvent.dragOver(page(1), { dataTransfer: { types: ["Files"], files } });
    expect(screen.getByText("Insert after page 1")).toBeInTheDocument();
    drop(page(1)); await screen.findByText("Added 1 file(s), 2 page(s) after page 1.");
    vi.mocked(prepareInput).mockResolvedValueOnce({ bytes, count: 1, report });
    drop(screen.getByRole("grid")); await screen.findByText("Added 1 file(s), 1 page(s) at the end.");
    expect(rows()).toHaveLength(6);
  });

  it("several native files keep file and page order; a rejected batch changes nothing", async () => {
    render(<App />); await openFile(3, "ABC.pdf");
    const input = screen.getByLabelText("Import PDFs or images");
    const chosen = (name: string) => ({ name, size: 4, arrayBuffer: async () => bytes.buffer });
    vi.spyOn(input, "click").mockImplementation(() => {
      Object.defineProperty(input, "files", { value: [chosen("P.pdf"), chosen("Q.pdf")], configurable: true });
      fireEvent.change(input);
    });
    vi.mocked(prepareInput).mockResolvedValueOnce({ bytes, count: 1, report }).mockResolvedValueOnce({ bytes, count: 2, report });
    click("More actions"); fireEvent.click(menuItem(/^Import several files/));
    await screen.findByText("Added 2 file(s), 3 page(s) at the end.");
    expect((await exported()).names.slice(3)).toEqual(["P.pdf:1", "Q.pdf:1", "Q.pdf:2"]);
    vi.mocked(prepareInput).mockResolvedValueOnce({ bytes, count: 1, report }).mockRejectedValueOnce(new Error("bad"));
    click("More actions"); fireEvent.click(menuItem(/^Import several files/));
    await screen.findByText("Q.pdf: bad"); expect(rows()).toHaveLength(6);
  });

  it("Open replaces the session only after confirmation and a chosen file", async () => {
    render(<App />); await openFile(3, "Old.pdf");
    fireEvent.click(page(1)); click("Delete");
    ctrl("o"); click("Cancel"); expect(sdk.files.open).toHaveBeenCalledTimes(1);
    ctrl("o"); vi.mocked(sdk.files.open).mockResolvedValueOnce(null); click("Choose file…");
    await screen.findByText("No file selected. Your pages are unchanged."); expect(rows()).toHaveLength(2);
    ctrl("o"); fileName = "New.pdf"; vi.mocked(prepareInput).mockResolvedValueOnce({ bytes, count: 4, report }); click("Choose file…");
    await screen.findByText(/^Opened 1 file/); expect(rows()).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});

describe("saving", () => {
  it("Ctrl+S and Save both export every page, whatever is selected, after one acknowledgement", async () => {
    render(<App />); await openFile(3, "My Doc.pdf");
    fireEvent.click(page(2));
    expect(ctrl("s")).toBe(false);
    expect(screen.getByRole("dialog", { name: "Before you save" })).toBeInTheDocument(); expect(runEngine).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByText(/My Doc\.pdf:/)).toBeInTheDocument();
    ctrl("s"); expect(runEngine).not.toHaveBeenCalled();
    click("I understand, save"); await screen.findByText("Saved 1 PDF file(s), 3 page(s).");
    expect(vi.mocked(runEngine).mock.calls[0][0]).toMatchObject({ groups: [[0, 1, 2]] });
    expect(sdk.files.save).toHaveBeenLastCalledWith("My Doc-organized.pdf", bytes);
    click("Save"); await waitFor(() => expect(sdk.files.save).toHaveBeenCalledTimes(2)); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(selectedNumbers()).toEqual([2]);
  });

  it("suppresses empty, repeated, concurrent and inactive saves, and reports success only after the host confirms", async () => {
    const view = (active: boolean) => <ToolActiveContext.Provider value={active}><App /></ToolActiveContext.Provider>;
    const { rerender, unmount } = render(view(true));
    expect(ctrl("s")).toBe(false); expect(runEngine).not.toHaveBeenCalled();   // still swallowed: no browser "Save page"
    await openFile(); ctrl("s", { repeat: true }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    ctrl("s"); expect(screen.getByRole("dialog")).toBeInTheDocument(); click("Cancel");
    ctrl("s"); let finish!: (saved: boolean) => void;
    vi.mocked(sdk.files.save).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    click("I understand, save"); await waitFor(() => expect(sdk.files.save).toHaveBeenCalledTimes(1));
    ctrl("s"); ctrl("s", { repeat: true }); expect(runEngine).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^Saved /)).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    finish(true); await screen.findByText("Saved 1 PDF file(s), 3 page(s).");
    rerender(view(false)); expect(ctrl("s")).toBe(true); expect(sdk.files.save).toHaveBeenCalledTimes(1);
    unmount(); expect(ctrl("s")).toBe(true);
  });

  it("keeps editable pages after cancelled, denied or failed saves", async () => {
    render(<App />); await openFile(3); fireEvent.click(page(1));
    ctrl("s"); vi.mocked(sdk.files.save).mockResolvedValueOnce(false); click("I understand, save");
    await screen.findByText("Save cancelled. Your pages are unchanged.");
    vi.mocked(sdk.files.save).mockRejectedValueOnce(new Error("File save permission denied")); ctrl("s");
    expect(await screen.findByRole("alert")).toHaveTextContent("File save permission denied");
    vi.mocked(runEngine).mockRejectedValueOnce(new Error("Source document is unavailable or too large.")); ctrl("s");
    expect(await screen.findByRole("alert")).toHaveTextContent("Source document is unavailable");
    expect(rows()).toHaveLength(3); expect(selectedNumbers()).toEqual([1]); expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("exports selected pages, ranges and chunks from the Export dialog using positions within the export", async () => {
    render(<App />); await openFile(5);
    fireEvent.click(page(2)); fireEvent.click(page(4), { ctrlKey: true }); fireEvent.click(page(5), { ctrlKey: true });
    click("More actions"); fireEvent.click(menuItem(/^Export pages/));
    const dialog = screen.getByRole("dialog", { name: "Export pages" });
    expect(within(dialog).getByLabelText("Pages")).toHaveValue("selected");
    fireEvent.change(within(dialog).getByLabelText("Output"), { target: { value: "ranges" } });
    fireEvent.change(within(dialog).getByLabelText(/^Ranges/), { target: { value: "1;2-3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    click("I understand, save"); await waitFor(() => expect(runEngine).toHaveBeenCalled());
    expect(vi.mocked(runEngine).mock.calls[0][0]).toMatchObject({ groups: [[1], [3, 4]] });
    await screen.findByText("Saved 2 PDF file(s), 3 page(s).");
    click("More actions"); fireEvent.click(menuItem(/^Export pages/));
    const again = screen.getByRole("dialog", { name: "Export pages" });
    fireEvent.change(within(again).getByLabelText("Pages"), { target: { value: "all" } });
    fireEvent.change(within(again).getByLabelText("Output"), { target: { value: "every" } });
    fireEvent.change(within(again).getByLabelText("Pages per file"), { target: { value: "2" } });
    fireEvent.click(within(again).getByRole("button", { name: "Export" }));
    await screen.findByText("Saved 3 PDF file(s), 5 page(s).");
    expect(vi.mocked(runEngine).mock.calls[1][0]).toMatchObject({ groups: [[0, 1], [2, 3], [4]] });
    click("More actions"); fireEvent.click(menuItem(/^Export pages/));
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("Output"), { target: { value: "ranges" } });
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText(/^Ranges/), { target: { value: "1-9" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Export" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ranges must be ascending, between 1 and 3.");
  });

  it("clearing the session asks first and removes everything", async () => {
    render(<App />); await openFile(); fireEvent.click(page(1));
    click("More actions"); fireEvent.click(menuItem(/^Clear session/)); click("Cancel"); expect(rows()).toHaveLength(3);
    click("More actions"); fireEvent.click(menuItem(/^Clear session/)); click("Clear session");
    expect(screen.getByRole("button", { name: "Open PDF" })).toBeInTheDocument(); expect(screen.getByText("Session cleared.")).toBeInTheDocument();
  });
});

describe("geometry, merge and properties", () => {
  const pageMenu = async (number: number, name: RegExp) => { fireEvent.contextMenu(page(number)); fireEvent.click(menuItem(name)); };
  const dialog = (name: string) => screen.getByRole("dialog", { name });
  const field = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const lastExport = () => vi.mocked(runEngine).mock.calls.map(([request]) => request).filter(request => request.kind === "export").pop() as { pages: { crop?: number[]; scale?: number }[]; metadata?: Record<string, string> };

  it("crops by percent as the page looks, keeps the dialog open on bad input, and one undo reverts", async () => {
    render(<App />); await openFile(3);
    await pageMenu(2, /^Crop…/);
    field(/^Left/, "95"); fireEvent.click(within(dialog("Crop pages")).getByRole("button", { name: "Crop" }));
    expect(within(dialog("Crop pages")).getByRole("alert")).toHaveTextContent("between 0 and 90"); expect(rows()).toHaveLength(3);
    field(/^Left/, "60"); field(/^Right/, "40"); fireEvent.click(within(dialog("Crop pages")).getByRole("button", { name: "Crop" }));
    expect(within(dialog("Crop pages")).getByRole("alert")).toHaveTextContent("at least 5% visible");
    field(/^Left/, "10"); field(/^Right/, "20"); fireEvent.click(within(dialog("Crop pages")).getByRole("button", { name: "Crop" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await exported(); expect(lastExport().pages.map(entry => entry.crop)).toEqual([undefined, [0.1, 0, 0.2, 0], undefined]);
    click("Undo"); await exported(); expect(lastExport().pages[1].crop).toBeUndefined();
  });

  it("crops white borders from detected content and reports pages that are blank", async () => {
    render(<App />); await openFile(3);
    fireEvent.click(page(1)); fireEvent.click(page(3), { ctrlKey: true });
    vi.mocked(contentBounds).mockResolvedValueOnce([0.1, 0.2, 0.1, 0.2]).mockResolvedValueOnce(null);
    click("More actions"); fireEvent.click(menuItem(/^Crop white borders/));
    await screen.findByText(/Cropped white borders on 1 page; 1 blank page\(s\) left as they were/);
    await exported(); expect(lastExport().pages.map(entry => entry.crop)).toEqual([[0.1, 0.2, 0.1, 0.2], undefined, undefined]);
    vi.mocked(contentBounds).mockResolvedValue(null);
    fireEvent.click(page(2)); click("More actions"); fireEvent.click(menuItem(/^Crop white borders/));
    expect(await screen.findByRole("alert")).toHaveTextContent("no content to crop to");
  });

  it("removes crop and scale from the selection only", async () => {
    render(<App />); await openFile(3);
    ctrl("a"); click("More actions"); fireEvent.click(menuItem(/^Scale…/));
    field(/^Scale \(%\)/, "150"); fireEvent.click(within(dialog("Scale pages")).getByRole("button", { name: "Scale" }));
    const scaled = () => Array.from(document.querySelectorAll(".page-source")).filter(caption => /150%/.test(caption.textContent!)).length;
    expect(scaled()).toBe(3);
    fireEvent.click(page(1)); click("More actions"); fireEvent.click(menuItem(/^Remove crop and scale/));
    expect(scaled()).toBe(2);
    await exported(); expect(lastExport().pages.map(entry => entry.scale)).toEqual([undefined, 1.5, 1.5]);
    fireEvent.click(page(1)); click("More actions"); expect(menuItem(/^Remove crop and scale/)).toBeDisabled();
  });

  it("splits selected pages into cells, selects the pieces and enforces the page limit", async () => {
    render(<App />); await openFile(3);
    await pageMenu(1, /^Split pages…/);
    field(/^Columns/, "1"); field(/^Rows/, "1"); fireEvent.click(within(dialog("Split pages")).getByRole("button", { name: "Split" }));
    expect(within(dialog("Split pages")).getByRole("alert")).toHaveTextContent("at least 2 pieces");
    field(/^Columns/, "2"); field(/^Rows/, "2"); fireEvent.click(within(dialog("Split pages")).getByRole("button", { name: "Split" }));
    expect(rows()).toHaveLength(6); expect(selectedNumbers()).toEqual([1, 2, 3, 4]);
    await exported(); expect(lastExport().pages.slice(0, 4).map(entry => entry.crop)).toEqual([[0, 0, 0.5, 0.5], [0.5, 0, 0, 0.5], [0, 0.5, 0.5, 0], [0.5, 0.5, 0, 0]]);
    click("Undo"); expect(rows()).toHaveLength(3);
  });

  it("merges the selection onto new sheets in one edit and needs two pages", async () => {
    render(<App />); await openFile(4);
    fireEvent.click(page(2)); click("More actions"); expect(menuItem(/^Merge pages…/)).toBeDisabled(); key({ key: "Escape" });
    fireEvent.click(page(2)); fireEvent.click(page(3), { ctrlKey: true });
    vi.mocked(runEngine).mockResolvedValueOnce({ bytes, count: 1, report });
    click("More actions"); fireEvent.click(menuItem(/^Merge pages…/));
    field(/^Pages across/, "2"); fireEvent.click(within(dialog("Merge pages")).getByRole("button", { name: "Merge" }));
    await screen.findByText("Merged 2 pages onto 1 page.");
    const request = vi.mocked(runEngine).mock.calls[0][0] as { kind: string; cols: number; rows: number; order: string; pages: unknown[] };
    expect(request).toMatchObject({ kind: "merge", cols: 2, rows: 1, order: "rows" }); expect(request.pages).toHaveLength(2);
    expect(rows()).toHaveLength(3); expect(selectedNumbers()).toEqual([2]);
    click("Undo"); expect(rows()).toHaveLength(4);
  });

  it("inserts a blank page the size of the neighbouring page, or A4 when none can be measured", async () => {
    render(<App />); await openFile(3);
    fireEvent.click(page(2)); vi.mocked(runEngine).mockResolvedValueOnce({ bytes, count: 1, report });
    key({ key: "Insert" });
    await screen.findByText("Inserted a blank page after page 2.");
    expect(vi.mocked(runEngine).mock.calls[0][0]).toEqual({ kind: "blank", width: 300, height: 400 });
    expect(rows()).toHaveLength(4); expect(selectedNumbers()).toEqual([3]);
    vi.mocked(pageSize).mockRejectedValueOnce(new Error("no preview")); vi.mocked(runEngine).mockResolvedValueOnce({ bytes, count: 1, report });
    click("More actions"); fireEvent.click(menuItem(/^Insert blank page/));
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(vi.mocked(runEngine).mock.calls[1][0]).toEqual({ kind: "blank", width: 595, height: 842 });
    click("Undo"); click("Undo"); expect(rows()).toHaveLength(3);
  });

  it("writes document properties, prefilled from the source, to saved files", async () => {
    vi.mocked(prepareInput).mockResolvedValueOnce({ bytes, count: 2, report: { ...report, info: { title: "Source title", author: "Ada" } } });
    render(<App />); click("Open PDF"); await screen.findByRole("row", { name: "Page 1" });
    click("More actions"); fireEvent.click(menuItem(/^Document properties…/));
    expect(screen.getByLabelText("Title")).toHaveValue("Source title"); expect(screen.getByLabelText("Subject")).toHaveValue("");
    field(/^Title/, "Annual report"); field(/^Keywords/, "a, b");
    fireEvent.click(within(dialog("Document properties")).getByRole("button", { name: "Apply" }));
    await exported();
    expect(lastExport().metadata).toEqual({ title: "Annual report", author: "Ada", subject: "", keywords: "a, b" });
  });
});
