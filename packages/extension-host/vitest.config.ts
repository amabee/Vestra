import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node only. Nothing in this package runs in a browser — the installer and
    // store use node:crypto, and the runtime is a server-side isolate.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
