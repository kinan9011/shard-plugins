import { t } from "@/lib/i18n";
/**
 * Unit converter utility functions
 */

export interface ConversionUnit {
  symbol: string;
  toBase: (value: number) => number;
  fromBase: (value: number) => number;
}

export interface ConversionCategory {
  units: Record<string, ConversionUnit>;
}

export const conversions: Record<string, ConversionCategory> = {
  length: {
    units: {
      meter: { symbol: "m", toBase: (v) => v, fromBase: (v) => v },
      kilometer: { symbol: "km", toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
      centimeter: { symbol: "cm", toBase: (v) => v / 100, fromBase: (v) => v * 100 },
      millimeter: { symbol: "mm", toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
      mile: { symbol: "mi", toBase: (v) => v * 1609.344, fromBase: (v) => v / 1609.344 },
      yard: { symbol: "yd", toBase: (v) => v * 0.9144, fromBase: (v) => v / 0.9144 },
      foot: { symbol: "ft", toBase: (v) => v * 0.3048, fromBase: (v) => v / 0.3048 },
      inch: { symbol: "in", toBase: (v) => v * 0.0254, fromBase: (v) => v / 0.0254 },
    },
  },
  weight: {
    units: {
      kilogram: { symbol: "kg", toBase: (v) => v, fromBase: (v) => v },
      gram: { symbol: "g", toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
      milligram: { symbol: "mg", toBase: (v) => v / 1000000, fromBase: (v) => v * 1000000 },
      pound: { symbol: "lb", toBase: (v) => v * 0.453592, fromBase: (v) => v / 0.453592 },
      ounce: { symbol: "oz", toBase: (v) => v * 0.0283495, fromBase: (v) => v / 0.0283495 },
    },
  },
  temperature: {
    units: {
      celsius: { symbol: "°C", toBase: (v) => v, fromBase: (v) => v },
      fahrenheit: {
        symbol: "°F",
        toBase: (v) => (v - 32) * 5 / 9,
        fromBase: (v) => v * 9 / 5 + 32,
      },
      kelvin: { symbol: "K", toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
    },
  },
  data: {
    units: {
      byte: { symbol: "B", toBase: (v) => v, fromBase: (v) => v },
      kilobyte: { symbol: "KB", toBase: (v) => v * 1024, fromBase: (v) => v / 1024 },
      megabyte: { symbol: "MB", toBase: (v) => v * 1024 * 1024, fromBase: (v) => v / (1024 * 1024) },
      gigabyte: { symbol: "GB", toBase: (v) => v * 1024 * 1024 * 1024, fromBase: (v) => v / (1024 * 1024 * 1024) },
    },
  },
};

/**
 * Get all available categories
 */
export function getCategories(): string[] {
  return Object.keys(conversions);
}

/**
 * Get units for a specific category
 */
export function getUnits(category: string): Record<string, ConversionUnit> {
  return conversions[category]?.units || {};
}

/**
 * Convert a value from one unit to another
 */
export function convert(value: number, category: string, fromUnit: string, toUnit: string): number {
  const conversion = conversions[category];
  if (!conversion) {
    throw new Error(t("error.unknownCategory", { category }));
  }

  const from = conversion.units[fromUnit];
  const to = conversion.units[toUnit];

  if (!from || !to) {
    throw new Error(t("error.unknownUnit", { from: fromUnit, to: toUnit }));
  }

  // Convert to base unit, then to target unit
  const baseValue = from.toBase(value);
  return to.fromBase(baseValue);
}

/**
 * Format a conversion result
 */
export function formatResult(value: number): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(6).replace(/\.?0+$/, "");
}
