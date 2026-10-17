import { expect, setDefaultTimeout, test } from "bun:test";
import { body, committedRepos, coverageBaseline, scopeOf, scopeRun } from "./lib/mutation-scope.ts";

// Scratch git repos and the scope bin run past bun's 5s default on a loaded machine.
setDefaultTimeout(30_000);

const repoWith = committedRepos("checks-mutation-scope-config-");

test("a mutate glob the config resolves to an absolute path scopes a changed source, as Stryker resolves it", async () => {
  const { repo, base } = await repoWith({
    "stryker.conf.mjs": 'import { resolve } from "node:path";\nexport default { mutate: [resolve("src/**/*.ts"), "!" + resolve("src/live/**")] };\n',
    "src/kept.ts": body("kept"),
    "src/live/layer.ts": body("layer"),
  });
  await repo.write({ "src/kept.ts": body("weakened"), "src/live/layer.ts": body("weakened") });

  expect(await scopeOf(repo, base)).toEqual({ SCOPE: "src/kept.ts", STALE_TESTS: "" });
});

test("a mutate entry with a mutation range fails rather than scoping nothing", async () => {
  const { repo, base } = await repoWith({ "stryker.conf.json": JSON.stringify({ mutate: ["src/kept.ts:1-10"] }), "src/kept.ts": body("kept") });
  await repo.write({ "src/kept.ts": body("weakened") });

  const done = await scopeRun(repo, base);

  expect(done.exitCode).toBe(2);
  expect(done.text).toContain("mutation-scope: the Stryker mutate entries src/kept.ts:1-10 name a mutation range");
  expect(done.text).not.toContain("SCOPE=");
});

test("a preload's import of a file reaches that file and not the index of a directory sharing its name", async () => {
  const { repo, base } = await repoWith({
    "src/covered.ts": body("covered"),
    "bunfig.toml": '[test]\npreload = "./test-setup.ts"\n',
    "test-setup.ts": `import { a0 } from "./support/assertions.ts";\n${body("setup")}`,
    "support/assertions.ts": body("assertions"),
    "support/assertions/index.ts": body("index"),
    "tests/unit/covered.test.ts": body("test"),
  });
  const baseline = await coverageBaseline(repo, [{ testFile: "tests/unit/covered.test.ts", sources: ["src/covered.ts"] }]);
  await repo.write({ "support/assertions.ts": body("weakened") });

  expect(await scopeOf(repo, base, baseline)).toEqual({ SCOPE: "src/covered.ts", STALE_TESTS: "tests/unit/covered.test.ts" });
});
