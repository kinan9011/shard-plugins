// Moved from the shard repo (tests/tools/uuid-generator-component.test.tsx). The host is a fake SDK.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { PermissionError, type ShardSdk } from "../src/shard-sdk";

function fakeSdk(writeText: (text: string) => Promise<void> = async () => {}) {
  return { toast: vi.fn(async () => {}), clipboard: { writeText: vi.fn(writeText) } } as unknown as ShardSdk;
}

describe("UUID Generator plugin", () => {
  it("generates identifiers and shows the implementation notes", async () => {
    render(<App sdk={fakeSdk()} />);

    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate 2 UUID v4s" }));

    const output = await screen.findByLabelText("Output");
    const lines = (output as HTMLTextAreaElement).value.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(screen.getByText(/v1, v6, and v7 are lightweight local implementations/i)).toBeInTheDocument();
    expect(screen.getByText("Which version should I pick most of the time?")).toBeInTheDocument();
  });

  it("generates RFC 4122 v5 from namespace and name", async () => {
    render(<App sdk={fakeSdk()} />);
    fireEvent.change(screen.getByLabelText("Version"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "www.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate 1 UUID v5/ }));
    const output = (await screen.findByLabelText("Output")) as HTMLTextAreaElement;
    expect(output.value).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("refuses a name-based UUID with a bad custom namespace and tells the host", async () => {
    const sdk = fakeSdk();
    render(<App sdk={sdk} />);
    fireEvent.change(screen.getByLabelText("Version"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "custom" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate 1 UUID v3/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Namespace must be a valid UUID");
    expect(sdk.toast).toHaveBeenCalledWith("Namespace must be a valid UUID", "error");
    expect(screen.queryByLabelText("Output")).not.toBeInTheDocument();
  });

  it("inspects a UUID v7 and a bad value", () => {
    render(<App sdk={fakeSdk()} />);
    const input = screen.getByLabelText("UUID or ULID");
    fireEvent.change(input, { target: { value: "01890a5d-ac96-774b-bcce-b302099a8057" } });
    expect(screen.getByText("RFC 4122 / RFC 9562")).toBeInTheDocument();
    expect(screen.getByText(/^2023-06-/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "nope" } });
    expect(screen.getByText("Not a valid UUID or ULID")).toBeInTheDocument();
  });

  it("uses a human-friendly label for ULIDs", () => {
    render(<App sdk={fakeSdk()} />);
    fireEvent.change(screen.getByLabelText("Version"), { target: { value: "ulid" } });
    expect(screen.getByRole("button", { name: "Generate 5 ULIDs" })).toBeInTheDocument();
  });

  it("copies the output through the host, and reports a refusal", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new PermissionError("Copying needs the clipboard:write permission.", "clipboard:write"));
    render(<App sdk={fakeSdk(writeText)} />);
    fireEvent.click(screen.getByRole("button", { name: /Generate 5 UUID v4s/ }));
    const output = (await screen.findByLabelText("Output")) as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole("button", { name: "Copy Output" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(output.value));

    fireEvent.click(screen.getByRole("button", { name: "Copy Output" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("clipboard:write");
  });
});
