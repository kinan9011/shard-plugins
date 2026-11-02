// Moved from the devtools repo (tests/tools/hash-generator-component.test.tsx). The host is a fake SDK; the hashing is the real module.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { PermissionError, type DevToolsSdk } from "../src/devtools-sdk";
import { createHasher } from "../src/hasher";

const { instance } = await WebAssembly.instantiate(readFileSync(resolve(__dirname, "../public/hash.wasm")), {});
const hasher = createHasher(instance);

function fakeSdk(overrides: { open?: () => Promise<unknown>; writeText?: (text: string) => Promise<void> } = {}) {
  return {
    files: { open: vi.fn(overrides.open ?? (async () => null)) },
    clipboard: { writeText: vi.fn(overrides.writeText ?? (async () => {})) },
  } as unknown as DevToolsSdk;
}

const sha256Hello = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

describe("Hash Generator plugin", () => {
  it("generates hashes after the input changes", async () => {
    render(<App sdk={fakeSdk()} hasher={hasher} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Enter text to generate hashes..."), { target: { value: "hello" } });

    await waitFor(() => expect(screen.getByPlaceholderText("SHA-256 hash will appear here...")).toHaveValue(sha256Hello));
    expect(screen.getByPlaceholderText("SHA-1 hash will appear here...")).toHaveValue("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
    expect(screen.getByPlaceholderText("SHA-3-256 hash will appear here...")).toHaveValue("3338be694f50c5f338814986cdf0686453a888b84f424d792af4b9202398f392");
    expect(screen.getByPlaceholderText("Keccak-256 hash will appear here...")).toHaveValue("1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8");
    expect(screen.getByPlaceholderText("SHA-384 hash will appear here...")).toHaveValue(
      "59e1748777448c69de6b800d7a33bbfb9ff1b463e44354c3553bcdb9c666fa90125a3c79f90397bdf5f6a13de828684f",
    );
    expect(screen.getByText("5 B hashed")).toBeInTheDocument();
  });

  it("clears the hashes when the input is cleared", async () => {
    render(<App sdk={fakeSdk()} hasher={hasher} />);
    fireEvent.change(screen.getByPlaceholderText("Enter text to generate hashes..."), { target: { value: "hello" } });
    await waitFor(() => expect(screen.getByPlaceholderText("SHA-256 hash will appear here...")).toHaveValue(sha256Hello));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.getByPlaceholderText("SHA-256 hash will appear here...")).toHaveValue(""));
  });

  it("shows HMAC output when a key is set", async () => {
    render(<App sdk={fakeSdk()} hasher={hasher} />);
    fireEvent.change(screen.getByPlaceholderText("Enter text to generate hashes..."), { target: { value: "what do ya want for nothing?" } });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByPlaceholderText("Enter secret key..."), { target: { value: "Jefe" } });

    await waitFor(() =>
      expect(screen.getByPlaceholderText("HMAC-SHA256 will appear here...")).toHaveValue("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"),
    );
  });

  it("hashes a file the host opens and shows its name and size", async () => {
    const sdk = fakeSdk({ open: async () => ({ name: "greeting.txt", size: 5, bytes: new TextEncoder().encode("hello") }) });
    render(<App sdk={sdk} hasher={hasher} />);

    fireEvent.click(screen.getByRole("tab", { name: "File" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose file…" }));

    await waitFor(() => expect(screen.getByPlaceholderText("SHA-256 hash will appear here...")).toHaveValue(sha256Hello));
    expect(sdk.files.open).toHaveBeenCalledWith({ as: "bytes" });
    expect(screen.getByTestId("hash-file-name")).toHaveTextContent("greeting.txt");
    expect(screen.getByText("5 B")).toBeInTheDocument();
  });

  it("says what to grant when opening files is refused", async () => {
    const sdk = fakeSdk({ open: async () => Promise.reject(new PermissionError("Opening files needs the files:open permission.", "files:open")) });
    render(<App sdk={sdk} hasher={hasher} />);
    fireEvent.click(screen.getByRole("tab", { name: "File" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose file…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("files:open");
  });

  it("copies a hash through the host, and reports a refusal", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new PermissionError("Copying needs the clipboard:write permission.", "clipboard:write"));
    render(<App sdk={fakeSdk({ writeText })} hasher={hasher} />);
    fireEvent.change(screen.getByPlaceholderText("Enter text to generate hashes..."), { target: { value: "hello" } });
    await waitFor(() => expect(screen.getByPlaceholderText("SHA-256 hash will appear here...")).toHaveValue(sha256Hello));

    fireEvent.click(screen.getByRole("button", { name: "Copy SHA-256" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(sha256Hello));
    expect(await screen.findByText("Copied")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy SHA-1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("clipboard:write");
  });
});
