import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "scripts", "backtest.ts");
const repository = fixtureRepos("checks-backtest-");

test(
  "the backtest attributes each refusal to the commit that introduced it",
  async () => {
    const { dir, write, commit } = await repository();

    await write({ "a.ts": "export const one = 1;\n" });
    await commit("clean start");
    await write({ "a.ts": "export const one = 1;\n// @ts-expect-error silenced\n" });
    await commit("plant a violation");
    await write({ "b.ts": "export const two = 2;\n" });
    await commit("unrelated change");

    const result = await $`bun ${SCRIPT} 10`.cwd(dir).nothrow().quiet();
    const text = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(text).toContain("refusals introduced: 1");
    expect(text).toContain("plant a violation");
    expect(text).toContain("a.ts:2 carries the machine-read directive `@ts-expect-error`");
  },
  120_000,
);
