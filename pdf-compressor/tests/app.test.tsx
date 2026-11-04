import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { sdk } from "../src/sdk";
import { compress, preview, runEngine } from "../src/pdf/client";

vi.mock("../src/sdk", () => ({ sdk: { files: { open: vi.fn(), save: vi.fn() } } }));
vi.mock("../src/pdf/client", () => ({ runEngine: vi.fn(), compress: vi.fn(), preview: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("parent", {});
  vi.mocked(sdk.files.open).mockResolvedValue({ name: "sample.pdf", size: 100, bytes: new Uint8Array(100) } as never);
  vi.mocked(runEngine).mockResolvedValue({ pages: 2, forms: 0, signatures: false });
  vi.mocked(compress).mockResolvedValue(new Uint8Array(40));
  vi.mocked(preview).mockResolvedValue(undefined);
  vi.mocked(sdk.files.save).mockResolvedValue(true);
});
async function opened() {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
  await screen.findByText("sample.pdf");
}
async function ready() {
  await opened();
  fireEvent.click(screen.getByLabelText("I understand these changes and will keep my original."));
  fireEvent.click(screen.getByRole("button", { name: "Compress PDF" }));
  await screen.findByRole("button", { name: "Save PDF" });
}
describe("compressor UI", () => {
  it("starts with the file drop area and reveals settings only after opening", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Drop a PDF here" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compress PDF" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    await screen.findByText("sample.pdf");
    expect(screen.getByText("More options").closest("details")).not.toHaveAttribute("open");
    fireEvent.change(screen.getByLabelText("Compression level"), { target: { value: "custom" } });
    expect(screen.getByText("More options").closest("details")).toHaveAttribute("open");
  });
  it("loads a dropped PDF and keeps drag feedback across nested elements", async () => {
    render(<App />);
    const main = screen.getByRole("main"), heading = screen.getByRole("heading", { name: "Drop a PDF here" });
    fireEvent.dragEnter(main, { dataTransfer: { types: ["Files"] } });
    fireEvent.dragEnter(heading, { dataTransfer: { types: ["Files"] } });
    fireEvent.dragLeave(heading);
    expect(main).toHaveClass("is-dragging");
    const file = new File(["pdf"], "dropped.PDF", { type: "" });
    const bytes = new Uint8Array([37, 80, 68, 70]);
    Object.defineProperty(file, "arrayBuffer", { value: vi.fn().mockResolvedValue(bytes.buffer) });
    fireEvent.drop(main, { dataTransfer: { files: [file] } });
    await screen.findByText("dropped.PDF");
    expect(main).not.toHaveClass("is-dragging");
    expect(runEngine).toHaveBeenCalledWith({ kind: "inspect", bytes }, expect.any(AbortSignal));
    expect(sdk.files.open).not.toHaveBeenCalled();
  });
  it("rejects multiple, non-PDF, empty and oversized drops before parsing", async () => {
    await opened(); vi.mocked(runEngine).mockClear();
    const main = screen.getByRole("main");
    const file = new File(["text"], "notes.txt", { type: "text/plain" });
    fireEvent.drop(main, { dataTransfer: { files: [file, file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("one PDF at a time");
    fireEvent.drop(main, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not a readable, supported PDF"));
    fireEvent.drop(main, { dataTransfer: { files: [new File([], "empty.pdf")] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("non-empty PDF up to 50 MiB"));
    const large = new File(["pdf"], "large.pdf");
    Object.defineProperty(large, "size", { value: 51 * 1024 * 1024 });
    fireEvent.drop(main, { dataTransfer: { files: [large] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("non-empty PDF up to 50 MiB"));
    expect(runEngine).not.toHaveBeenCalled();
    expect(screen.getByText("sample.pdf")).toBeInTheDocument();
  });
  it("opens the native picker outside Shard and reads the selected PDF", async () => {
    vi.stubGlobal("parent", window);
    render(<App />);
    const picker = screen.getByLabelText("Browse files"), click = vi.spyOn(picker, "click");
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    expect(click).toHaveBeenCalled();
    const file = new File(["pdf"], "selected.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([37, 80, 68, 70]).buffer });
    fireEvent.change(picker, { target: { files: [file] } });
    await screen.findByText("selected.pdf");
    expect(sdk.files.open).not.toHaveBeenCalled();
  });
  it("requires a file and acknowledgement", async () => {
    await opened();
    expect(screen.getByRole("button", { name: "Compress PDF" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I understand these changes and will keep my original."));
    expect(screen.getByRole("button", { name: "Compress PDF" })).toBeEnabled();
  });
  it("selects presets and clears stale results on option changes", async () => {
    await ready();
    expect(screen.getByText("60%")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Compression level"), { target: { value: "strong" } });
    expect(screen.queryByRole("button", { name: "Save PDF" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Page resolution")).toHaveValue("100");
    expect(screen.getByLabelText("JPEG quality · 60%")).toHaveValue("60");
    fireEvent.change(screen.getByLabelText("Color output"), { target: { value: "bw" } });
    expect(screen.getByLabelText("Black/white threshold · 160")).toBeInTheDocument();
    expect(screen.queryByLabelText(/JPEG quality/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Flatten form fields")).toBeChecked();
  });
  it("reports save success only after host confirmation and allows retry after denial", async () => {
    await ready();
    vi.mocked(sdk.files.save).mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Save PDF" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("PDF saved.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save PDF" }));
    await screen.findByText("PDF saved.");
    expect(sdk.files.save).toHaveBeenLastCalledWith("sample-compressed.pdf", new Uint8Array(40));
  });
  it("preserves the result when a save is cancelled", async () => {
    await ready(); vi.mocked(sdk.files.save).mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Save PDF" }));
    await screen.findByText("Save cancelled. The result is still available.");
    expect(screen.getByRole("button", { name: "Save PDF" })).toBeEnabled();
  });
  it("cancels processing without replacing the original", async () => {
    await opened();
    vi.mocked(compress).mockImplementation((_bytes, _options, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")))));
    fireEvent.click(screen.getByLabelText("I understand these changes and will keep my original."));
    fireEvent.click(screen.getByRole("button", { name: "Compress PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel processing" }));
    await screen.findByText("Processing cancelled. Your original is unchanged.");
    expect(screen.getByText("sample.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save PDF" })).not.toBeInTheDocument();
  });
  it("keeps the old source after a rejected import", async () => {
    await opened(); vi.mocked(runEngine).mockRejectedValue(new Error("error.encrypted"));
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    await screen.findByRole("alert");
    expect(screen.getByText("sample.pdf")).toBeInTheDocument();
  });
  it("shows a larger result honestly and still saves requested transformations", async () => {
    vi.mocked(compress).mockResolvedValue(new Uint8Array(120)); await ready();
    expect(screen.getByText("Larger")).toBeInTheDocument();
    expect(screen.getByText(/This PDF did not get smaller/)).toBeInTheDocument();
  });
  it("does not change settings while saving", async () => {
    await ready(); let finish!: (saved: boolean) => void;
    vi.mocked(sdk.files.save).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Save PDF" }));
    expect(screen.getByLabelText("Compression level")).toBeDisabled();
    fireEvent.drop(screen.getByRole("main"), { dataTransfer: { files: [] } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => finish(true));
    await waitFor(() => expect(screen.getByLabelText("Compression level")).toBeEnabled());
  });
});
