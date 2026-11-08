import { $ } from "bun";
import { expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT, ran } from "../lib/fixture-repo.ts";
import { body, committedRepos } from "../lib/mutation-scope.ts";

// Scratch git repos and the scope bin run past bun's 5s default on a loaded machine.
setDefaultTimeout(30_000);

const SCOPE = join(CHECKOUT, "src", "testing", "mutation-scope.ts");
const repoWith = committedRepos("checks-mutation-shards-");
const mutants = (count: number) => ({ mutants: Array.from({ length: count }, (_, id) => ({ id: `${id}` })) });

test("the bin splits the tracked mutated files by the last report's mutant counts, leaving out what the globs exclude", async () => {
  const { repo } = await repoWith({
    "stryker.conf.json": JSON.stringify({ mutate: ["src/**/*.ts", "!src/bin.ts"] }),
    "src/a.ts": body("a"),
    "src/b.ts": body("b"),
    "src/c.ts": body("c"),
    "src/d.ts": body("d"),
    "src/bin.ts": body("bin"),
    "lib/outside.ts": body("outside"),
  });
  await repo.write({ "last.json": JSON.stringify({ files: { "src/a.ts": mutants(6), "src/b.ts": mutants(5), "src/c.ts": mutants(4), "src/d.ts": mutants(3) } }) });

  const done = await ran($`bun ${SCOPE} --shards 2 last.json`.cwd(repo.dir));

  expect(done.exitCode).toBe(0);
  expect(done.text).toContain('SHARDS=["src/a.ts,src/d.ts","src/b.ts,src/c.ts"]');
  expect(done.text).toContain("mutation-scope: shard 1 holds 2 file(s) and about 9 mutant(s)");
});

test("with no last report the bin still splits by file count, and says each file weighs one mutant", async () => {
  const { repo } = await repoWith({ "stryker.conf.json": JSON.stringify({ mutate: ["src/**/*.ts"] }), "src/a.ts": body("a"), "src/b.ts": body("b"), "src/c.ts": body("c") });

  const done = await ran($`bun ${SCOPE} --shards 2 missing.json`.cwd(repo.dir));

  expect(done.exitCode).toBe(0);
  expect(done.text).toContain('SHARDS=["src/a.ts,src/c.ts","src/b.ts"]');
  expect(done.text).toContain("no last report at missing.json, so each file weighs one mutant");
});

test("a last report that is not a Stryker report fails the bin rather than splitting by a guess", async () => {
  const { repo } = await repoWith({ "src/a.ts": body("a"), "last.json": "{}" });

  const done = await ran($`bun ${SCOPE} --shards 2 last.json`.cwd(repo.dir));

  expect(done.exitCode).toBe(2);
  expect(done.text).toContain("last.json is not a Stryker mutation report");
});
