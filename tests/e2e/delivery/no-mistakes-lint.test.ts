import { $ } from "bun";
import { expect, test } from "bun:test";
import { noMistakesLintCommand } from "../../lib/no-mistakes-config.ts";
import { fixtureRepos, ran, type FixtureRepo, type Ran } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-no-mistakes-lint-");

const BUILT = {
  "package.json": JSON.stringify({ scripts: { lint: "true", build: "cp input.txt generated.txt", typecheck: "true" } }),
  "input.txt": "a\n",
  "generated.txt": "a\n",
  "other.ts": "export const x = 1;\n",
};

function lintStep(repo: FixtureRepo): Promise<Ran> {
  const command = noMistakesLintCommand();
  if (typeof command !== "string") throw new Error(".no-mistakes.yaml carries no commands.lint string");
  return ran($`sh -c ${command}`.cwd(repo.dir));
}

test(
  "an uncommitted edit the build leaves alone passes rather than failing as drift",
  async () => {
    const repo = await open(BUILT);
    await repo.commit("feat: base");
    await repo.write({ "other.ts": "export const x = 2;\n" });
    const run = await lintStep(repo);
    expect(run).toEqual({ exitCode: 0, text: expect.any(String) });
  },
  60_000,
);

test(
  "a committed generated file the build rewrites fails rather than passing",
  async () => {
    const repo = await open({ ...BUILT, "generated.txt": "stale\n" });
    await repo.commit("feat: base");
    const run = await lintStep(repo);
    expect(run.exitCode).toBe(1);
    expect(run.text).toContain("generated.txt");
  },
  60_000,
);

test(
  "an uncommitted source edit whose generated file was not rebuilt fails rather than passing",
  async () => {
    const repo = await open(BUILT);
    await repo.commit("feat: base");
    await repo.write({ "input.txt": "b\n" });
    const run = await lintStep(repo);
    expect(run.exitCode).toBe(1);
    expect(run.text).toContain("generated.txt");
  },
  60_000,
);
