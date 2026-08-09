import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Schemas and key handling; nothing here touches a DOM.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
