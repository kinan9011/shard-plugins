import animate from "tailwindcss-animate";
import type { Config } from "tailwindcss";
import preset from "./tailwind.preset";

export default {
  presets: [preset],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  plugins: [animate],
} satisfies Config;
