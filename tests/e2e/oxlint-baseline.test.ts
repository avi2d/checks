import { $ } from "bun";
import { expect, test } from "bun:test";
import { CHECKOUT } from "./lib/fixture-repo.ts";

test("this repository commits no oxlint-suppressions.json", async () => {
  expect(await $`git ls-files -- oxlint-suppressions.json`.cwd(CHECKOUT).text()).toBe("");
});
