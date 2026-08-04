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
    rollupOptions: {
      /**
       * Two documents, two windows.
       *
       * The player's controls live in a separate transparent window stacked
       * over mpv's video surface — a native window the page cannot draw on
       * top of. Giving that window its own document keeps it free of the
       * catalogue's routing and data fetching; it needs neither.
       */
      input: {
        main: path.join(rendererRoot, "index.html"),
        overlay: path.join(rendererRoot, "overlay.html"),
      },
    },
  },
  server: {
    port: 5273,
    strictPort: true,
  },
});
