import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { sdk } from "../src/sdk";
import { prepareInput, runEngine } from "../src/pdf/client";

vi.mock("../src/Thumbnail", () => ({ Thumbnail: () => <span>Page preview</span> }));
vi.mock("../src/pdf/preview", () => ({ clearPreviews: vi.fn() }));
vi.mock("../src/pdf/client", () => ({ prepareInput: vi.fn(), runEngine: vi.fn() }));

const report = { forms: 0, outlines: false, signatures: false, annotations: 0 };
const sourceBytes = new Uint8Array([37, 80, 68, 70]);
beforeEach(() => {
  vi.mocked(prepareInput).mockReset().mockResolvedValue({ bytes: sourceBytes, count: 3, report });
  vi.mocked(runEngine).mockReset().mockResolvedValue({ bytes: sourceBytes, extension: "pdf" });
  vi.mocked(sdk.files.open).mockReset().mockResolvedValue({ name: "sample.pdf", size: sourceBytes.length, bytes: sourceBytes });
  vi.mocked(sdk.files.save).mockReset().mockResolvedValue(true);
});

async function importFile() {
  fireEvent.click(screen.getByRole("button", { name: "Open file" }));
  await screen.findByRole("heading", { name: "3 pages · 1 files" });
}

describe("organizer workflow", () => {
  it("imports, edits, undoes, extracts selected pages and handles save cancellation", async () => {
    render(<App />);
    await importFile();
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Page 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate selected 90°" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate selected" }));
    expect(screen.getByRole("heading", { name: "4 pages · 1 files" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.change(screen.getByLabelText("Output"), { target: { value: "selected" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I understand/ }));
    vi.mocked(sdk.files.save).mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    await screen.findByText("Save cancelled. Your pages are unchanged.");
    const request = vi.mocked(runEngine).mock.calls[0][0];
    expect(request.kind).toBe("export");
    if (request.kind === "export") {
      expect(request.groups).toEqual([[1]]);
      expect(request.pages[1].rotation).toBe(90);
    }
    expect(sdk.files.save).toHaveBeenCalledWith("organized.pdf", sourceBytes);
  });

  it("selects ranges, deletes/restores and reorders via keyboard accessible controls", async () => {
    render(<App />); await importFile();
    fireEvent.change(screen.getByLabelText("Select pages"), { target: { value: "1,3" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply selection" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(screen.getByRole("heading", { name: "1 pages · 1 files" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Move page 3 earlier" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I understand/ }));
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    await screen.findByText("Saved 1 PDF file(s), 3 page(s).");
    const request = vi.mocked(runEngine).mock.calls[0][0];
    if (request.kind === "export") expect(request.pages.map(page => page.index)).toEqual([0, 2, 1]);
  });

  it("splits using current page numbers and surfaces permission errors", async () => {
    render(<App />); await importFile();
    fireEvent.change(screen.getByLabelText("Output"), { target: { value: "ranges" } });
    fireEvent.change(screen.getByLabelText("Ranges"), { target: { value: "1;2-3" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I understand/ }));
    vi.mocked(runEngine).mockResolvedValueOnce({ bytes: sourceBytes, extension: "zip" });
    vi.mocked(sdk.files.save).mockRejectedValueOnce(new Error("File save permission denied"));
    fireEvent.click(screen.getByRole("button", { name: "Export PDF / ZIP" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
    expect(vi.mocked(runEngine).mock.calls[0][0]).toMatchObject({ groups: [[0], [1, 2]] });
    expect(sdk.files.save).toHaveBeenCalledWith("organized.zip", sourceBytes);
  });

  it("cancels imports atomically and preserves the current pages", async () => {
    render(<App />); await importFile();
    vi.mocked(prepareInput).mockImplementationOnce((_, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")))));
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => expect(prepareInput).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Cancel processing" }));
    await screen.findByText("Cancelled. Your pages are unchanged.");
    expect(screen.getByRole("heading", { name: "3 pages · 1 files" })).toBeInTheDocument();
  });

  it("reports invalid input without adding pages and respects picker cancellation", async () => {
    render(<App />);
    vi.mocked(prepareInput).mockRejectedValueOnce(new Error("Encrypted PDFs are not supported"));
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("sample.pdf: Encrypted PDFs");
    expect(screen.getByRole("heading", { name: "Your pages" })).toBeInTheDocument();
    vi.mocked(sdk.files.open).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(prepareInput).toHaveBeenCalledTimes(1);
  });
});
