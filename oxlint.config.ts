import { defineConfig } from "./dist/presets/oxlint.js";

export default defineConfig({
  effect: {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    excludeFiles: [
      "src/quality/effect-channel/**",
      "src/complexity/readability/**",
      "src/quality/data-shape/**",
      // oxlint and knip read a config's default export synchronously, so these builders refuse a config by throwing.
      "src/quality/presets/oxlint.ts",
      "src/quality/presets/knip.ts",
    ],
  },
  ignorePatterns: ["node_modules/**", "dist/**/*.js"],
  rules: {
    "eslint/no-restricted-properties": [
      "error",
      {
        object: "process",
        property: "exit",
        message:
          "Return the exit status instead: a bin returns it from the program runMain runs. unicorn/no-process-exit passes over a file with a shebang, so this rule stands in for it there.",
      },
    ],
  },
  overrides: [{ files: ["src/quality/comment-matchers.ts"], rules: { "effect-channel/no-throw": "off" } }],
});
