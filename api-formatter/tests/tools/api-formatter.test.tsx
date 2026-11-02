import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiFormatter } from "@/components/tools/ApiFormatter";

describe("ApiFormatter", () => {
  it("formats JSON with two-space indentation", () => {
    render(<ApiFormatter />);
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: '{"name":"John","age":30}' } });
    fireEvent.click(screen.getByRole("button", { name: "Format JSON" }));
    expect(screen.getByDisplayValue(/"name": "John"/)).toHaveValue('{\n  "name": "John",\n  "age": 30\n}');
    expect(screen.getByRole("button", { name: /Copy output/ })).toBeInTheDocument();
  });

  it("shows no output for invalid JSON", () => {
    render(<ApiFormatter />);
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "{nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Format JSON" }));
    expect(screen.queryByRole("button", { name: /Copy output/ })).not.toBeInTheDocument();
  });
});
