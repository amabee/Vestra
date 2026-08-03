import reactHooks from "eslint-plugin-react-hooks";

import { baseConfig } from "./base.js";

/**
 * ESLint config for React packages (shared UI, Atlas, Nova renderer).
 * @type {import("eslint").Linter.Config[]}
 */
export const reactConfig = [
  ...baseConfig,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
];

export default reactConfig;
