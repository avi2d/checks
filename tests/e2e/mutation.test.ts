import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, ran } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-mutation-");
const SCRIPT = join(CHECKOUT, "src", "testing", "mutation.ts");
const PRESET = join(CHECKOUT, "stryker.preset.js");
const { CI: _ci, ...withoutCi } = process.env;

test("checks-mutation refuses a full run outside CI and names the workflow command", async () => {
  const repo = await open({});
  const refused = await ran(
    $`bun ${SCRIPT}`.cwd(repo.dir).env({
      ...withoutCi,
      PATH: `${join(CHECKOUT, "node_modules/.bin")}:${withoutCi["PATH"] ?? ""}`,
    }),
  );
  expect(refused.exitCode).toBe(2);
  expect(refused.text).toContain("gh workflow run mutation");
}, 60_000);

test("loading the preset for an unscoped stryker run outside CI refuses it", async () => {
  const refused = await ran($`bun ${PRESET} run`.env(withoutCi));
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("refusing a full mutation run outside CI");
});

test("loading the preset for a scoped run, a CI run or another command lets it through", async () => {
  expect((await ran($`bun ${PRESET} run --mutate src/billing.ts`.env(withoutCi))).exitCode).toBe(0);
  expect((await ran($`bun ${PRESET} run`.env({ ...withoutCi, CI: "true" }))).exitCode).toBe(0);
  expect((await ran($`bun ${PRESET} init`.env(withoutCi))).exitCode).toBe(0);
});
