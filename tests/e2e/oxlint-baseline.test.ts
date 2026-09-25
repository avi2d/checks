import { $ } from "bun";
import { expect, test } from "bun:test";
import { resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");

test("this repository commits no oxlint-suppressions.json", async () => {
  expect(await $`git ls-files -- oxlint-suppressions.json`.cwd(CHECKOUT).text()).toBe("");
});
