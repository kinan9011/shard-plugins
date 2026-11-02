import path from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

// `base: "./"` makes every asset URL relative: the app serves a plugin from shard-plugin://<id>/.
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: { target: "es2020", outDir: "dist", emptyOutDir: true },
});
