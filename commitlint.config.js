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

const CO_AUTHORED_BY = /^[ \t]*co-authored-by[ \t]*:/im;

export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "no-co-authored-by": ({ raw }) => [
          !CO_AUTHORED_BY.test(raw ?? ""),
          "a commit names one author: drop the Co-authored-by trailer",
        ],
      },
    },
  ],
  rules: {
    "type-enum": [conventionalEnum[0], conventionalEnum[1], [...conventionalEnum[2], ...houseTypes]],
    "no-co-authored-by": [2, "always"],
  },
};
