/**
 * Frontend lint policy.
 *
 * The frontend had no ESLint config at all — `next lint` is deprecated in Next
 * 15 and prompted interactively rather than checking anything, so nothing was
 * ever enforced here. That's how the unused imports and swallowed errors this
 * pass cleaned up got in.
 *
 * The rules chosen are the ones that catch real defects rather than style
 * opinions (Prettier owns formatting). Two are errors on purpose:
 *
 *  • exhaustive-deps — a stale closure in this app means a calendar rendering
 *    last week's data with no visible failure.
 *  • no-floating-promises — an unawaited write in an offline-first app is a
 *    lost write that nothing reports.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import next from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "next-env.d.ts",
      // Its own config: outside the tsconfig project, so type-aware rules
      // can't parse it and there's nothing here worth linting anyway.
      "eslint.config.mjs",
      // A byte-identical mirror of backend/src/lib/recurrence/rrule.ts, and the
      // backend is the only side allowed to edit it. If this linter autofixed
      // the copy, the mirror test would demand a resync, the resync would undo
      // the fix, and the next --fix would redo it — a loop with no fixed point.
      // The backend's own lint config covers this file.
      "src/lib/recurrence/rrule.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": next,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...next.configs.recommended.rules,

      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-floating-promises": "error",

      // Unused code is either a mistake or a leftover; both are worth removing.
      // The underscore escape hatch keeps deliberately-ignored args readable.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // `any` defeats the type checking the rest of this config relies on, but
      // the Prisma-shaped boundaries legitimately need it — warn, don't block.
      "@typescript-eslint/no-explicit-any": "warn",

      // These fire constantly on correct React code (event handlers returning
      // promises, template literals over unknown) without indicating a defect.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: false },
      ],
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },

  {
    // Next's config API requires async signatures whether or not the body
    // awaits anything, so the rule reports a shape the framework mandates.
    files: ["next.config.ts"],
    rules: { "@typescript-eslint/require-await": "off" },
  },

  {
    // Tests assert on deliberately malformed input, so the strictness that
    // protects application code just gets in the way here.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      // node:test's `test()` returns a promise the runner already owns.
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
);
