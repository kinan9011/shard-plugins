import type { Field, Value, Values } from "./engine";
import { MAX_ROWS, validate } from "./engine";
import { FormError } from "./errors";

// RFC 4180 quoting, including embedded newlines and escaped double quotes.
export function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === undefined) throw new FormError("error.csv");
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === "," || c === "\n" || c === "\r" || c === undefined) {
      row.push(cell); cell = ""; closed = false;
      if (c !== ",") {
        if (row.some(value => value !== "")) rows.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (rows.length > MAX_ROWS + 1) throw new FormError("error.rows");
      }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (closed || c === '"') throw new FormError("error.csv");
    else cell += c;
  }
  return rows;
}

export function parseMapping(text: string, format: "json" | "csv", fields: Field[]): Values[] {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new FormError("error.mappingSize");
  text = text.replace(/^\uFEFF/, "");
  let input: unknown;
  if (format === "json") {
    try { input = JSON.parse(text); } catch { throw new FormError("error.json"); }
    if (!Array.isArray(input)) input = [input];
  } else {
    const [headers, ...rows] = csvRows(text);
    if (!headers?.length || headers.some(name => !name) || new Set(headers).size !== headers.length) throw new FormError("error.csvHeaders");
    input = rows.map(row => {
      if (row.length !== headers.length) throw new FormError("error.csvColumns");
      return Object.fromEntries(headers.map((name, index) => {
        const field = fields.find(field => field.name === name); let value: Value = row[index];
        if (field?.kind === "checkbox") {
          if (!/^(true|false|1|0)$/i.test(value)) throw new FormError("error.boolean", { name });
          value = /^(true|1)$/i.test(value);
        } else if (field?.multi) {
          try { value = value === "" ? [] : JSON.parse(value); } catch { throw new FormError("error.choice", { name }); }
        }
        return [name, value];
      }));
    });
  }
  if (!Array.isArray(input) || !input.length || input.length > MAX_ROWS) throw new FormError("error.rows");
  return input.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new FormError("error.mappingObject");
    for (const [name, value] of Object.entries(row)) {
      if (typeof value !== "string" && typeof value !== "boolean" && !(Array.isArray(value) && value.every(v => typeof v === "string"))) throw new FormError("error.mappingValue", { name });
    }
    try { validate(fields, row as Values, false); }
    catch (error) { if (error instanceof FormError) throw new FormError(error.key, { ...error.vars, row: index + 1 }); throw error; }
    return row as Values;
  });
}
