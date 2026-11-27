import { defineConfig } from "./dist/presets/oxlint.js";

export default defineConfig({
  effect: {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    excludeFiles: [
      "src/quality/effect-channel/**",
      "src/complexity/readability/**",
      "src/quality/data-shape/**",
      "src/testing/bun-test/**",
      // Each tool takes a config's default export as a plain value, so these builders cannot run an Effect.
      "src/quality/presets/oxlint.ts",
      "src/quality/presets/knip.ts",
      "src/quality/presets/dependency-cruiser.ts",
      "src/quality/presets/stylelint.ts",
      // Bun loads each test preload into the fresh global of every test file under --parallel, so an Effect import there would load into each file.
      "src/testing/flake-preload.ts",
      "src/testing/local-test-preload.ts",
      // Stryker loads this plugin synchronously and stops the run on a throw, so it cannot run an Effect.
      "src/testing/mutation-guard-plugin.ts",
      // Every bin loads this launcher before it can exec the compiled build, so an Effect import would slow the path the build exists to speed up.
      "src/core/native-launch.ts",
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
  overrides: [
    { files: ["src/quality/comment-matchers.ts"], rules: { "effect-channel/no-throw": "off" } },
    { files: ["src/testing/local-test-preload.ts"], rules: { "eslint/no-restricted-properties": "off" } },
  ],
});
