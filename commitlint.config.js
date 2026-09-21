import configConventional from "@commitlint/config-conventional";

const houseTypes = [
  "theme",
  "herdr",
  "renamer",
  "shell",
  "pi",
  "home",
  "audit",
  "comments",
  "unslop",
];

const conventionalEnum = configConventional.rules["type-enum"];

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [conventionalEnum[0], conventionalEnum[1], [...conventionalEnum[2], ...houseTypes]],
  },
};
