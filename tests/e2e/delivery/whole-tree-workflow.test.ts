import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { isRecord } from "../../../src/delivery/workflow-references.ts";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-whole-tree-workflow-");
const script = join(CHECKOUT, "src", "delivery", "workflows.ts");

test("a consumer workflow set does not omit the whole-tree run or trigger it on other branches", async () => {
  const repo = await open({ "package.json": JSON.stringify({ name: "acme", private: true }) });
  await repo.commit("start");
  const run = (args: readonly string[]) => ran($`bun ${script} ${args}`.cwd(repo.dir).env(withoutPullRequestEvent()));
  expect((await run(["--write"])).exitCode).toBe(0);
  const workflow: unknown = Bun.YAML.parse(await Bun.file(join(repo.dir, ".github", "workflows", "whole-tree-run.yml")).text());
  expect(isRecord(workflow) ? workflow["on"] : undefined).toEqual({ push: { branches: ["main"] }, workflow_dispatch: null });
  expect((await run([])).exitCode).toBe(0);
}, 30_000);
