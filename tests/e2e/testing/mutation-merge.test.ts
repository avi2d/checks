import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo } from "../lib/fixture-repo.ts";
import { readReport, reusedOf } from "../lib/stryker-consumer.ts";

const MERGE = join(CHECKOUT, "src", "testing", "mutation-merge.ts");
const open = fixtureRepos("checks-mutation-merge-");

async function strykerRepo(): Promise<FixtureRepo> {
  const repo = await open({});
  await repo.write({
    ".gitignore": "node_modules\nreports\nshards\n.stryker-tmp\n",
    "package.json": '{"name":"stryker-fixture","type":"module","private":true}\n',
    "stryker.conf.mjs": `export default ${JSON.stringify({
      plugins: ["@stryker-mutator/*", "@hughescr/stryker-bun-runner"],
      testRunner: "bun",
      coverageAnalysis: "perTest",
      reporters: ["json"],
      mutate: ["src/**/*.ts"],
      bun: { testFiles: ["tests/unit/a.test.ts", "tests/unit/b.test.ts"] },
      concurrency: 1,
    })};\n`,
    "src/a.ts": "export const above = (n: number) => n > 1;\n",
    "src/b.ts": "export const below = (n: number) => n < 5 && n !== 0;\n",
    "tests/unit/a.test.ts": ['import { expect, test } from "bun:test";', 'import { above } from "../../src/a.ts";', "", 'test("above", () => {', "  expect(above(2)).toBe(true);", "  expect(above(1)).toBe(false);", "});", ""].join("\n"),
    "tests/unit/b.test.ts": ['import { expect, test } from "bun:test";', 'import { below } from "../../src/b.ts";', "", 'test("below", () => {', "  expect(below(4)).toBe(true);", "});", ""].join("\n"),
  });
  await repo.commit("base");
  await symlink(join(CHECKOUT, "node_modules"), join(repo.dir, "node_modules"));
  return repo;
}

async function runShard(repo: FixtureRepo, name: string, mutate: string): Promise<void> {
  const done = await ran($`bunx stryker run --incremental --mutate ${mutate}`.cwd(repo.dir));
  expect(done.exitCode).toBe(0);
  await mkdir(join(repo.dir, "shards", name), { recursive: true });
  await rename(join(repo.dir, "reports", "mutation", "mutation.json"), join(repo.dir, "shards", name, "mutation.json"));
  await rename(join(repo.dir, "reports", "stryker-incremental.json"), join(repo.dir, "shards", name, "stryker-incremental.json"));
}

const statuses = async (path: string) =>
  Object.fromEntries(Object.entries((await readReport(path)).files).map(([file, { mutants }]) => [file, mutants.map(({ replacement, status }) => `${replacement} ${status}`).toSorted()]));

test("two Stryker shards merge into one report and one incremental state a whole-tree run reuses every mutant from", async () => {
  const repo = await strykerRepo();
  await runShard(repo, "1", "src/a.ts");
  await runShard(repo, "2", "src/b.ts");

  const report = await ran($`bun ${MERGE} reports/mutation/mutation.json shards/1/mutation.json shards/2/mutation.json`.cwd(repo.dir));
  const state = await ran($`bun ${MERGE} reports/stryker-incremental.json shards/1/stryker-incremental.json shards/2/stryker-incremental.json`.cwd(repo.dir));
  expect([report.exitCode, state.exitCode]).toEqual([0, 0]);
  const merged = await statuses(join(repo.dir, "reports", "mutation", "mutation.json"));
  expect(Object.keys(merged)).toEqual(["src/a.ts", "src/b.ts"]);

  const whole = await ran($`bunx stryker run --incremental`.cwd(repo.dir));

  expect(whole.exitCode).toBe(0);
  const reused = reusedOf(whole.text);
  expect(reused?.[0]).toBe(reused?.[1]);
  expect(reused?.[1]).toBeGreaterThan(0);
  expect(await statuses(join(repo.dir, "reports", "mutation", "mutation.json"))).toEqual(merged);
}, 240_000);

test("two shards that both hold one file fail the merge and write nothing", async () => {
  const repo = await open({});
  const shard = JSON.stringify({ schemaVersion: "1.0", files: { "src/a.ts": { source: "a", mutants: [] } } });
  await repo.write({ "one.json": shard, "two.json": shard });

  const done = await ran($`bun ${MERGE} out/mutation.json one.json two.json`.cwd(repo.dir));

  expect(done.exitCode).toBe(2);
  expect(done.text).toContain("mutation-merge: src/a.ts is in both one.json and two.json");
  expect(await Bun.file(join(repo.dir, "out", "mutation.json")).exists()).toBe(false);
});
