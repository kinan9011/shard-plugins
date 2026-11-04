import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

// The Shard design tokens as Tailwind utilities (`bg-background`, `text-muted-foreground`, `rounded-lg`, ...).
// The colors are CSS variables, which the app sends through the SDK (`theme.vars`): apply them to `:root`
// (see src/App.tsx) and the plugin follows the app's theme, light or dark.
// Mirrors theme.extend in the app's tailwind.config.ts.
export default {
  darkMode: ["class"],
  content: [],
  theme: {
    extend: {
      fontSize: {
        "2xs": ["11px", { lineHeight: "16px" }],
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "20px" }],
        base: ["14px", { lineHeight: "22px" }],
        lg: ["15px", { lineHeight: "22px" }],
        xl: ["17px", { lineHeight: "24px" }],
        "2xl": ["22px", { lineHeight: "28px", letterSpacing: "-0.02em" }],
        "3xl": ["26px", { lineHeight: "32px", letterSpacing: "-0.02em" }],
      },
      fontFamily: {
        sans: ["var(--font-ui)"],
        mono: ["var(--font-code)"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        // The accent as a fill under white text. <alpha-value> keeps `bg-primary-solid/90` working; the fallback to --primary is in the base layer below.
        "primary-solid": { DEFAULT: "hsl(var(--primary-solid) / <alpha-value>)", foreground: "hsl(var(--primary-solid-foreground) / <alpha-value>)" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" },
        warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))" },
        info: { DEFAULT: "hsl(var(--info))", foreground: "hsl(var(--info-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [
    // A host that does not send --primary-solid gets --primary; the host's own :root values still win.
    plugin(({ addBase }) => addBase({ ":root": { "--primary-solid": "var(--primary)", "--primary-solid-foreground": "var(--primary-foreground)" } })),
  ],
} satisfies Config;
