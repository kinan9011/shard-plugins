import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

// Run on its own with `npm test`. The shard repo's root config includes these tests too.
export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true, setupFiles: ["./tests/setup.ts"], include: ["tests/**/*.test.{ts,tsx}"] },
});
