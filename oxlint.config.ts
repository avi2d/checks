import { defineConfig } from "./dist/presets/oxlint.js";

export default defineConfig({
  effect: {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    excludeFiles: [
      "src/quality/effect-channel/**",
      "src/complexity/readability/**",
      "src/quality/data-shape/**",
      // oxlint, knip and dependency-cruiser take a config's default export as a plain value, so these builders cannot run an Effect.
      "src/quality/presets/oxlint.ts",
      "src/quality/presets/knip.ts",
      "src/quality/presets/dependency-cruiser.ts",
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
