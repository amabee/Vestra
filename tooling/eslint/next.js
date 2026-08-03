import { reactConfig } from "./react.js";

/**
 * ESLint config for Vestra Atlas (Next.js App Router).
 * @type {import("eslint").Linter.Config[]}
 */
export const nextConfig = [
  ...reactConfig,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Server Components legitimately use default exports for pages/layouts.
      "import/no-default-export": "off",
    },
  },
  {
    // Route handlers and server-only modules may read process.env directly.
    files: ["**/app/api/**/*.ts", "**/lib/server/**/*.ts", "**/env.ts"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
];

export default nextConfig;
