import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PasswordGenerator } from "@/components/tools/PasswordGenerator";

const generated = () => (screen.getByDisplayValue(/.+/) as HTMLInputElement).value;

describe("PasswordGenerator", () => {
  it("generates a 16 character password with every character type", () => {
    render(<PasswordGenerator />);
    expect(generated()).toHaveLength(16);
  });

  it("makes a new password on request", () => {
    render(<PasswordGenerator />);
    const first = generated();
    fireEvent.click(screen.getByRole("button", { name: "Generate new password" }));
    expect(generated()).not.toBe(first);
  });

  it("uses only digits when only numbers are on", () => {
    render(<PasswordGenerator />);
    for (const id of ["uppercase", "lowercase", "symbols"]) fireEvent.click(document.getElementById(id)!);
    expect(generated()).toMatch(/^\d{16}$/);
  });
});
