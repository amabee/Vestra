import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure logic over data the app already holds; nothing here touches a DOM.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
