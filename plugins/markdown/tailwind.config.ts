import typography from "@tailwindcss/typography";
import type { Config } from "tailwindcss";
import preset from "./tailwind.preset";

export default {
  presets: [preset],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // `prose` styles the rendered preview.
  plugins: [typography],
} satisfies Config;
