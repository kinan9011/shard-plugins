import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { PermissionError, type DevToolsSdk } from "../src/devtools-sdk";

// Moved from the devtools repo (tests/tools/markdown-editor.test.tsx). The host is a fake SDK.
function fakeSdk(writeText: (text: string) => Promise<void> = async () => {}) {
  return { toast: vi.fn(async () => {}), clipboard: { writeText: vi.fn(writeText) } } as unknown as DevToolsSdk;
}
const MarkdownEditor = ({ sdk = fakeSdk() }: { sdk?: DevToolsSdk }) => <App sdk={sdk} />;

describe("MarkdownEditor", () => {
  it("uses theme-aware classes for the preview panel", () => {
    render(<MarkdownEditor />);

    const previewHeading = screen.getByText("HTML Preview");
    const previewPanel = previewHeading.parentElement?.nextElementSibling;

    expect(previewPanel).toBeInTheDocument();
    expect(previewPanel).toHaveClass("bg-background");
    expect(previewPanel).toHaveClass("text-foreground");
    expect(previewPanel).not.toHaveClass("bg-white");
  });

  it("updates the preview when the markdown changes", async () => {
    render(<MarkdownEditor />);

    fireEvent.change(screen.getByPlaceholderText("Write your markdown here..."), {
      target: { value: "# Preview Title" },
    });

    await waitFor(() => {
      expect(screen.getByText("Preview Title")).toBeInTheDocument();
    });
  });

  it("renders unordered lists as bullet items", async () => {
    render(<MarkdownEditor />);

    fireEvent.change(screen.getByPlaceholderText("Write your markdown here..."), {
      target: { value: "## Highlights\n- First item\n- Second item" },
    });

    await waitFor(() => {
      expect(screen.getByRole("list")).toBeInTheDocument();
    });

    expect(screen.getByText("First item").tagName).toBe("LI");
    expect(screen.getByText("Second item").tagName).toBe("LI");
  });
});

describe("MarkdownEditor sanitizing", () => {
  it("does not render script handlers in the preview", async () => {
    const { container } = render(<MarkdownEditor />);
    fireEvent.change(screen.getByPlaceholderText("Write your markdown here..."), {
      target: { value: "# Safe\n\n<img src=x onerror=alert(1)>" },
    });
    await waitFor(() => expect(screen.getByText("Safe")).toBeInTheDocument());
    expect(container.querySelector("[onerror]")).toBeNull();
  });
});

describe("MarkdownEditor copy", () => {
  it("copies the Markdown through the host", async () => {
    const sdk = fakeSdk();
    render(<MarkdownEditor sdk={sdk} />);
    fireEvent.change(screen.getByPlaceholderText("Write your markdown here..."), { target: { value: "# Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(sdk.clipboard.writeText).toHaveBeenCalledWith("# Title"));
  });

  it("copies the generated HTML, and tells the user when the permission is not granted", async () => {
    const sdk = fakeSdk(async () => {
      throw new PermissionError("This plugin needs the clipboard:write permission.", "clipboard:write");
    });
    render(<MarkdownEditor sdk={sdk} />);
    fireEvent.change(screen.getByPlaceholderText("Write your markdown here..."), { target: { value: "# Title" } });
    await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Copy HTML" }));
    await waitFor(() => expect(sdk.toast).toHaveBeenCalledWith(expect.stringContaining("clipboard:write"), "error"));
  });
});
