import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

// `base: "./"` makes every asset URL relative: the app serves a plugin from shard-plugin://<id>/.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { target: "es2020", outDir: "dist", emptyOutDir: true },
});
