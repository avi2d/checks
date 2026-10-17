import configConventional from "@commitlint/config-conventional";

const houseTypes: ReadonlyArray<string> = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
];

const conventionalTypes: ReadonlyArray<string> = configConventional.rules["type-enum"][2];

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", [...new Set([...conventionalTypes, ...houseTypes])]],
  },
};
