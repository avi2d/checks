import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { TestFileTimings } from "../../../src/core/settings.ts";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-test-shard-output-");
const SCRIPT = join(CHECKOUT, "src", "testing", "test.ts");
const PASSING = 'import { test } from "bun:test"; test("passes", () => {});\n';

test("shards report all excluded files instead of claiming the shard alone is empty", async () => {
  const repo = await open({
    "package.json": JSON.stringify({ name: "acme" }),
    "checks.config.ts": 'export default { testFileSkips: ["tests/unit/one.test.ts"] };\n',
    "tests/unit/one.test.ts": 'throw new Error("excluded file ran");\n',
  });
  await repo.commit("test: exclude the selected tier");
  const env = { ...withoutPullRequestEvent(), CI: "true" };
  for (const shard of ["1/2", "2/2"]) {
    const result = await ran($`bun ${SCRIPT} --tier=unit --shard=${shard}`.cwd(repo.dir).env(env));
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain("all selected test files are excluded, so no test ran");
    expect(result.text).not.toContain("this shard has no test files");
    expect(result.text).not.toContain("excluded file ran");
  }
});

test("an empty sharded tier is not mislabeled as an empty shard", async () => {
  const repo = await open({ "package.json": JSON.stringify({ name: "acme" }) });
  await repo.commit("test: leave the tier empty");
  const result = await ran($`bun ${SCRIPT} --tier=unit --shard=1/2`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), CI: "true" }));
  expect(result.exitCode).toBe(0);
  expect(result.text).toContain("the unit tier has no test files");
  expect(result.text).not.toContain("this shard has no test files");
});

test("an unassigned shard does not claim its included files were excluded or start Bun", async () => {
  const repo = await open({
    "package.json": JSON.stringify({ name: "acme" }),
    "tests/unit/one.test.ts": 'throw new Error("unassigned file ran");\n',
  });
  await repo.commit("test: leave the second shard empty");
  const result = await ran($`bun ${SCRIPT} --tier=unit --shard=2/2`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), CI: "true" }));
  expect(result.exitCode).toBe(0);
  expect(result.text).toContain("this shard has no test files");
  expect(result.text).not.toContain("all selected test files are excluded");
  expect(result.text).not.toContain("unassigned file ran");
});

for (const ci of [false, true]) {
  for (const fails of [false, true]) {
    test(`a ${ci ? "CI" : "local"} ${fails ? "failed" : "passing"} run emits reusable file timings without zero values`, async () => {
      const repo = await open({
        "package.json": JSON.stringify({ name: "acme" }),
        "checks.config.ts": "export default { agentTests: { allowLocal: true } };\n",
        "tests/unit/one.test.ts": PASSING,
        "tests/unit/two.test.ts": fails
          ? 'import { test } from "bun:test"; test("fails", () => { throw new Error("expected failure"); });\n'
          : PASSING,
      });
      await repo.commit("test: record file timings");
      const { CI: _ci, ...env } = withoutPullRequestEvent();
      const result = await ran($`bun ${SCRIPT} --tier=unit --parallel=1 --junit=report.xml`.cwd(repo.dir).env({ ...env, ...(ci ? { CI: "true" } : {}) }));
      expect(result.exitCode).toBe(fails ? 1 : 0);
      const line = result.text.split("\n").find((value) => value.startsWith("checks-test: testFileTimings "));
      expect(line).toBeDefined();
      const json: unknown = JSON.parse(line?.slice("checks-test: testFileTimings ".length) ?? "null");
      const timings = Effect.runSync(Schema.decodeUnknownEffect(TestFileTimings)(json));
      const xml = await Bun.file(join(repo.dir, "report.xml")).text();
      const suites = [...xml.matchAll(/<testsuite\b[^>]*file="([^"]+)"[^>]*time="([^"]+)"[^>]*>/g)];
      expect(suites.map(([, file]) => file ?? "").sort((left, right) => left.localeCompare(right))).toEqual(["tests/unit/one.test.ts", "tests/unit/two.test.ts"]);
      expect(Object.keys(timings).every((file) => suites.some(([, reported]) => reported === file))).toBe(true);
      for (const [, file, time] of suites) {
        const seconds = Number(time);
        expect(timings[file ?? ""]).toBe(seconds > 0 ? seconds : undefined);
      }
    });
  }
}
