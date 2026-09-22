import { $ } from "bun";
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { refused, SYNTAXES } from "../../scripts/comments.ts";

const CHECKOUT = resolve(import.meta.dir, "..", "..");

test(
  "no comment in this repository's code is one the checks refuse",
  async () => {
    const listed = await $`git ls-files -z --cached`.cwd(CHECKOUT).quiet();
    const files = listed
      .stdout.toString()
      .split("\0")
      .filter((file) => file !== "" && !file.startsWith("dist/"))
      .filter((file) => file.slice(file.lastIndexOf(".") + 1) in SYNTAXES);
    expect(files.length).toBeGreaterThan(5);
    const found: string[] = [];
    for (const file of files) {
      found.push(...refused(file, await Bun.file(`${CHECKOUT}/${file}`).text()));
    }
    expect(found).toEqual([]);
  },
  60_000,
);
