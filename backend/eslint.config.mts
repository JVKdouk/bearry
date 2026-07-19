import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettierConfig from "eslint-config-prettier";
import prettier from "eslint-plugin-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintPluginUnicorn from "eslint-plugin-unicorn";

export default defineConfig([
  globalIgnores(["node_modules/", "dist/", ".generated/", ".dagger/"]),
  {
    ignores: ["node_modules/", "dist/", ".generated/", ".dagger/"],
    // Tests are included deliberately: they were excluded from both linting and
    // typechecking, which is how a test helper drifted out of sync with the
    // type it was constructing and nothing noticed.
    files: ["src/**/*.ts", "core/**/*.ts", "tests/**/*.ts"],
    plugins: { js, prettier, unicorn: eslintPluginUnicorn },
    extends: ["js/recommended"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
  },
  tseslint.configs.recommended,
  eslintPluginUnicorn.configs.recommended,
  {
    rules: {
      ...prettierConfig.rules,
      "unicorn/no-null": "off",
      "unicorn/filename-case": ["error", { case: "camelCase" }],
      "unicorn/no-array-reverse": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/prefer-module": "off",
      "unicorn/catch-error-name": "off",
      "unicorn/switch-case-braces": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/prefer-top-level-await": "off",
      "unicorn/numeric-separators-style": "off",
      "@typescript-eslint/no-namespace": "off",
      // Type-aware safety: catch unhandled/misused promises and dead awaits — the
      // bugs that actually bite a Node backend. (projectService is enabled above.)
      "@typescript-eslint/no-floating-promises": "error",
      // Fastify hooks are legitimately async and get assigned to hook-typed
      // consts; keep every other void-return check (the ones that catch real
      // bugs like passing an async fn to forEach or an event handler).
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { variables: false } },
      ],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Tests construct deliberately-malformed input and name files after what
    // they cover, so the naming and strictness rules that protect application
    // code only generate noise here.
    files: ["tests/**/*.ts"],
    rules: {
      "unicorn/filename-case": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "unicorn/no-useless-undefined": "off",
      // node:test's `test()` returns a promise the runner already owns.
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
]);
