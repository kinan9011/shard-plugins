import type { Config } from "tailwindcss";
import preset from "./tailwind.preset";

export default {
  presets: [preset],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
} satisfies Config;
