import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rendererRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Renderer build.
 *
 * The output is loaded from disk by Electron, not served, so `base: "./"`
 * matters: absolute asset paths would resolve against the filesystem root and
 * silently 404 inside the packaged app.
 */
export default defineConfig({
  root: rendererRoot,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.join(rendererRoot, "src"),
    },
  },
  build: {
    outDir: path.join(rendererRoot, "../dist-renderer"),
    emptyOutDir: true,
    // Electron 43 ships Chromium 13x; no need to transpile for older engines.
    target: "chrome130",
    sourcemap: true,
  },
  server: {
    port: 5273,
    strictPort: true,
  },
});
