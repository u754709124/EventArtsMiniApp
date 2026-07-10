import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "apps/admin/dist/**",
      "apps/miniapp/dist/**",
      "apps/miniapp/babel.config.cjs",
      "playwright-report/**",
      "test-results/**",
      "uploads/**",
      "apps/api/prisma/dev.db*",
      "docs/design/*.png",
      "prettier.config.cjs"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly"
      }
    }
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
);
