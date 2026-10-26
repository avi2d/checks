import { test } from "bun:test";
import { docsRepos, plantRedThenGreen, type Plant } from "./lib/docs-repo.ts";

const PLANTS: readonly (Plant & { readonly pin: string })[] = [
  {
    pin: "the Bun version",
    red: "Bun 1.4.3 runs every bin.",
    refusal: "4: carries `1.4.3`, a version .bun-version pins. Name .bun-version instead",
    green: "Bun, at the version `.bun-version` pins, runs every bin.",
  },
  {
    pin: "an optional peer",
    red: "```sh\nbun add -d html-validate@11.16.0\n```",
    refusal: "5: carries `html-validate@11.16.0`, a version package.json pins. Name package.json instead",
    green: "<!-- generated install: bun run build writes it from package.json -->\n\n```sh\nbun add -d html-validate@11.16.0\n```\n\n<!-- end generated install -->",
  },
];

const repository = docsRepos();

test(
  "a version package.json or .bun-version pins goes red on a line a change adds to a living doc, and green once the doc names the file or a build writes the line",
  async () => {
    const repo = await repository();
    await repo.put("package.json", JSON.stringify({ name: "tools", peerDependencies: { "html-validate": "11.16.0" } }));
    await repo.put(".bun-version", "1.4.3\n");
    await plantRedThenGreen(
      repo,
      PLANTS,
      ({ pin }) => [`plant ${pin}`, `name what holds ${pin}`],
      "docs: no line the range adds or edits copies a version package.json or .bun-version pins",
    );
  },
  120_000,
);
