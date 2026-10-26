import { expect, setDefaultTimeout, test } from "bun:test";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { type FixtureRepo } from "./lib/fixture-repo.ts";
import { body, committedRepos, coverageBaseline, recorded, scopeOf, scopeRun } from "./lib/mutation-scope.ts";

// Scratch git repos and the scope bin run past bun's 5s default on a loaded machine.
setDefaultTimeout(30_000);

const repoWith = committedRepos("checks-mutation-scope-");
const NOTHING = { SCOPE: "", STALE_TESTS: "" };
const TUI_DASH_CONFIG = 'export default { mutate: ["packages/*/src/**/*.ts", "!packages/*/src/live/**", "!packages/*/src/bin.ts"] };\n';

type SharedMutant = { readonly source: string; readonly coveredBy: string[]; readonly killedBy: string[] };

async function sharedMutantBaseline(repo: FixtureRepo, mutants: readonly SharedMutant[]): Promise<string> {
  const order = [...new Set(mutants.flatMap((mutant) => [...mutant.coveredBy, ...mutant.killedBy]))].sort();
  const ids = new Map(order.map((testFile, index) => [testFile, `${index}`] as const));
  const testFiles = await recorded(repo, ids);
  const bySource = new Map<string, Array<{ coveredBy: string[]; killedBy: string[] }>>();
  for (const mutant of mutants) {
    const listed = bySource.get(mutant.source) ?? [];
    listed.push({
      coveredBy: mutant.coveredBy.map((testFile) => ids.get(testFile) ?? ""),
      killedBy: mutant.killedBy.map((testFile) => ids.get(testFile) ?? ""),
    });
    bySource.set(mutant.source, listed);
  }
  const files = Object.fromEntries([...bySource].map(([source, listed]) => [source, { source: body("value"), mutants: listed }]));
  const path = join(repo.dir, "baseline.json");
  await repo.write({ "baseline.json": JSON.stringify({ files, testFiles }) });
  return path;
}

const sorted = (list: string | undefined): string[] => (list ?? "").split(",").sort();

test("a pull request that changes nothing the mutate globs match has an empty scope", async () => {
  const { repo, base } = await repoWith({ "src/kept.ts": body("kept") });
  await repo.write({ "src/notes.md": "not mutated\n" });

  expect(await scopeOf(repo, base)).toEqual(NOTHING);
});

test("a renamed source is scoped under both names, a deleted one not at all, and an added one under its own name", async () => {
  const { repo, base } = await repoWith({
    "stryker.conf.json": JSON.stringify({ mutate: ["src/**/*.ts"] }),
    "src/edited.ts": body("edited"),
    "src/old.ts": body("moved"),
    "src/gone.ts": body("gone"),
    "src/untouched.ts": body("untouched"),
    "lib/outside.ts": body("outside"),
  });
  await repo.write({ "src/edited.ts": body("edited") + "export const more = 1;\n", "src/fresh.ts": body("fresh") });
  await rename(join(repo.dir, "src/old.ts"), join(repo.dir, "src/new.ts"));
  await rename(join(repo.dir, "lib/outside.ts"), join(repo.dir, "src/inside.ts"));
  await rm(join(repo.dir, "src/gone.ts"));

  const scope = await scopeOf(repo, base);

  expect(sorted(scope["SCOPE"])).toEqual(["src/edited.ts", "src/fresh.ts", "src/inside.ts", "src/new.ts", "src/old.ts"]);
});

test("a source the config's negated globs exclude stays out of scope, as src/live and bin.ts do in tui-dash", async () => {
  const { repo, base } = await repoWith({
    "stryker.conf.mjs": TUI_DASH_CONFIG,
    "packages/quota/src/live/layer.ts": body("layer"),
    "packages/quota/src/bin.ts": body("bin"),
    "packages/quota/src/quotas.ts": body("quotas"),
  });
  await repo.write({
    "packages/quota/src/live/layer.ts": body("weakened"),
    "packages/quota/src/bin.ts": body("weakened"),
    "packages/quota/src/quotas.ts": body("weakened"),
    "packages/ui/src/sources.ts": body("sources"),
  });

  const scope = await scopeOf(repo, base);

  expect(sorted(scope["SCOPE"])).toEqual(["packages/quota/src/quotas.ts", "packages/ui/src/sources.ts"]);
});

test("a test change alone brings in an unchanged source whose kills it holds, as layout.ts lost two in tui-dash PR 11", async () => {
  const { repo, base } = await repoWith({
    "stryker.conf.mjs": TUI_DASH_CONFIG,
    "packages/ui/src/layout.ts": body("layout"),
    "packages/session-quota/src/notes.ts": body("notes"),
    "packages/session-quota/src/live/layer.ts": body("layer"),
    "tests/unit/dashboard/snapshot.test.ts": body("snapshot"),
    "tests/unit/session-quota/app.test.ts": body("app"),
  });
  const baseline = await coverageBaseline(repo, [
    { testFile: "tests/unit/dashboard/snapshot.test.ts", sources: ["packages/ui/src/layout.ts"] },
    { testFile: "tests/unit/session-quota/app.test.ts", sources: ["packages/session-quota/src/notes.ts"] },
  ]);
  await repo.write({
    "packages/session-quota/src/notes.ts": body("weakened"),
    "packages/session-quota/src/live/layer.ts": body("weakened"),
    "tests/unit/dashboard/snapshot.test.ts": body("weakened"),
  });

  const done = await scopeRun(repo, base, baseline);

  expect(done.exitCode).toBe(0);
  expect(done.text).toContain("SCOPE=packages/session-quota/src/notes.ts,packages/ui/src/layout.ts\n");
  expect(done.text).toContain("mutation-scope: packages/ui/src/layout.ts enters through tests/unit/dashboard/snapshot.test.ts");
});

function testedRepo(): Promise<{ repo: FixtureRepo; base: string }> {
  return repoWith({
    "src/covered.ts": body("covered"),
    "src/other.ts": body("other"),
    "tests/unit/covered.test.ts": body("test"),
  });
}

const testedBaseline = (repo: FixtureRepo, killsOnly = false): Promise<string> =>
  coverageBaseline(repo, [{ testFile: "tests/unit/covered.test.ts", sources: ["src/covered.ts"], killsOnly }], ["src/other.ts"]);

test("a changed test with no baseline report fails rather than scoping nothing", async () => {
  const { repo, base } = await testedRepo();
  await repo.write({ "tests/unit/covered.test.ts": body("weakened") });

  const done = await scopeRun(repo, base, join(repo.dir, "no-baseline.json"));

  expect(done.exitCode).toBe(2);
  expect(done.text).toContain("mutation-scope: tests/unit/covered.test.ts changed, but no baseline report at");
  expect(done.text).not.toContain("SCOPE=");
});

test("a changed test pulls its covered source into scope", async () => {
  const { repo, base } = await testedRepo();
  await repo.write({ "tests/unit/covered.test.ts": body("weakened") });
  const baseline = await testedBaseline(repo);

  expect(await scopeOf(repo, base, baseline)).toEqual({ ...NOTHING, SCOPE: "src/covered.ts" });
});

test("a kill names the covering test where restored coverage no longer does", async () => {
  const { repo, base } = await testedRepo();
  await repo.write({ "tests/unit/covered.test.ts": body("weakened") });
  const baseline = await testedBaseline(repo, true);

  expect((await scopeOf(repo, base, baseline))["SCOPE"]).toBe("src/covered.ts");
});

test("a source covered by a changed test but killed first by another test stays in scope", async () => {
  const { repo, base } = await repoWith({
    "src/shared.ts": body("shared"),
    "tests/unit/first.test.ts": body("first"),
    "tests/unit/second.test.ts": body("second"),
  });
  const baseline = await sharedMutantBaseline(repo, [
    { source: "src/shared.ts", coveredBy: ["tests/unit/first.test.ts", "tests/unit/second.test.ts"], killedBy: ["tests/unit/first.test.ts"] },
  ]);
  await repo.write({ "tests/unit/second.test.ts": body("weakened") });

  expect(await scopeOf(repo, base, baseline)).toEqual({ ...NOTHING, SCOPE: "src/shared.ts" });
});

test("a source with only static mutants stays in scope through each test the report lists as killing them", async () => {
  const { repo, base } = await repoWith({
    "src/table.ts": body("table"),
    "tests/unit/table-a.test.ts": body("test"),
    "tests/unit/table-b.test.ts": body("test"),
  });
  const baseline = await sharedMutantBaseline(repo, [
    { source: "src/table.ts", coveredBy: [], killedBy: ["tests/unit/table-b.test.ts", "tests/unit/table-a.test.ts"] },
  ]);
  await repo.write({ "tests/unit/table-a.test.ts": body("weakened") });

  expect((await scopeOf(repo, base, baseline))["SCOPE"]).toBe("src/table.ts");
});

test("a static mutant whose one recorded killer the pull request leaves alone keeps that kill, so a change to another test leaves its source out", async () => {
  const { repo, base } = await repoWith({
    "src/table.ts": body("table"),
    "src/row.ts": body("row"),
    "tests/unit/table-a.test.ts": body("test"),
    "tests/unit/table-b.test.ts": body("test"),
  });
  const baseline = await sharedMutantBaseline(repo, [
    { source: "src/table.ts", coveredBy: [], killedBy: ["tests/unit/table-b.test.ts"] },
    { source: "src/row.ts", coveredBy: ["tests/unit/table-a.test.ts"], killedBy: ["tests/unit/table-a.test.ts"] },
  ]);
  await repo.write({ "tests/unit/table-a.test.ts": body("weakened") });

  expect((await scopeOf(repo, base, baseline))["SCOPE"]).toBe("src/row.ts");
});

test("a deleted test still pulls its covered source into scope", async () => {
  const { repo, base } = await testedRepo();
  const baseline = await testedBaseline(repo);
  await rm(join(repo.dir, "tests/unit/covered.test.ts"));

  expect((await scopeOf(repo, base, baseline))["SCOPE"]).toBe("src/covered.ts");
});

test("a test the baseline never saw leaves the scope empty", async () => {
  const { repo, base } = await testedRepo();
  const baseline = await testedBaseline(repo);
  await repo.write({ "tests/unit/fresh.test.ts": body("fresh") });

  expect(await scopeOf(repo, base, baseline)).toEqual(NOTHING);
});

async function mondayRepo(): Promise<{ repo: FixtureRepo; base: string; baseline: string }> {
  const { repo, base } = await repoWith({ "src/monday.ts": body("monday"), "src/tuesday.ts": body("tuesday"), "tests/unit/monday.test.ts": body("test") });
  const baseline = await coverageBaseline(repo, [{ testFile: "tests/unit/monday.test.ts", sources: ["src/monday.ts"] }], ["src/tuesday.ts"]);
  return { repo, base, baseline };
}

test("a changed test the merge base holds but an older baseline report lacks widens the scope to every mutated source", async () => {
  const { repo, baseline } = await mondayRepo();
  await repo.write({ "tests/unit/tuesday.test.ts": body("test") });
  const tuesday = await repo.commit("tuesday test");
  await repo.write({ "tests/unit/tuesday.test.ts": body("weakened") });

  const done = await scopeRun(repo, tuesday, baseline);

  expect(done.exitCode).toBe(0);
  expect(done.text).toContain("SCOPE=src/monday.ts,src/tuesday.ts\n");
  expect(done.text).toContain("mutation-scope: the baseline report did not run tests/unit/tuesday.test.ts as the merge base holds it");
});

test("a changed test whose merge-base source differs from the one the baseline report ran widens the scope to every mutated source", async () => {
  const { repo, baseline } = await mondayRepo();
  await repo.write({ "tests/unit/monday.test.ts": body("tuesday") });
  const tuesday = await repo.commit("tuesday assertion");
  await repo.write({ "tests/unit/monday.test.ts": body("weakened") });

  const done = await scopeRun(repo, tuesday, baseline);

  expect(done.exitCode).toBe(0);
  expect(done.text).toContain("SCOPE=src/monday.ts,src/tuesday.ts\n");
  expect(done.text).toContain("mutation-scope: the baseline report did not run tests/unit/monday.test.ts as the merge base holds it");
});

test("a changed test whose merge-base source the baseline report ran scopes only the sources it covers", async () => {
  const { repo, base, baseline } = await mondayRepo();
  await repo.write({ "tests/unit/monday.test.ts": body("weakened") });

  expect(await scopeOf(repo, base, baseline)).toEqual({ ...NOTHING, SCOPE: "src/monday.ts" });
});

test("a source an older baseline report holds no mutant of enters when a test changes", async () => {
  const { repo, base } = await repoWith({
    "src/monday.ts": body("monday"),
    "src/tuesday.ts": body("tuesday"),
    "tests/unit/monday.test.ts": body("test"),
  });
  const baseline = await coverageBaseline(repo, [{ testFile: "tests/unit/monday.test.ts", sources: ["src/monday.ts"] }]);
  await repo.write({ "tests/unit/monday.test.ts": body("weakened") });

  const done = await scopeRun(repo, base, baseline);

  expect(done.exitCode).toBe(0);
  expect(done.text).toContain("SCOPE=src/monday.ts,src/tuesday.ts\n");
  expect(done.text).toContain("mutation-scope: src/tuesday.ts enter, as the baseline report holds no mutant of them");
});

test("a changed test and a changed source scope together without doubling", async () => {
  const { repo, base } = await testedRepo();
  const baseline = await testedBaseline(repo);
  await repo.write({
    "tests/unit/covered.test.ts": body("weakened"),
    "src/covered.ts": body("covered") + "export const more = 1;\n",
    "src/other.ts": body("other") + "export const more = 1;\n",
  });

  expect((await scopeOf(repo, base, baseline))["SCOPE"]).toBe("src/covered.ts,src/other.ts");
});

async function helpedRepo(): Promise<{ repo: FixtureRepo; base: string; baseline: string }> {
  const { repo, base } = await repoWith({
    "src/covered.ts": body("covered"),
    "src/other.ts": body("other"),
    "src/joined.ts": body("joined"),
    "src/named.ts": body("named"),
    "src/slashed.ts": body("slashed"),
    "src/listed.ts": body("listed"),
    "src/sibling.ts": body("sibling"),
    "tests/lib/effect.ts": body("effect"),
    "tests/lib/tree.ts": `import { effect0 } from "./effect";\n${body("tree")}`,
    "tests/lib/unused.ts": body("unused"),
    "tests/fixtures/eval/run.json": "{}\n",
    "tests/fixtures/evaluated/run.json": "{}\n",
    "tests/unit/covered.test.ts": `import { effect0 } from "../lib/effect";\n${body("test")}`,
    "tests/unit/other.test.ts": `import {\n  tree0,\n} from "../lib/tree.ts";\n${body("test")}`,
    "tests/unit/joined.test.ts": `const run = join(import.meta.dir, "..", "fixtures", "eval", "run.json");\n${body("test")}`,
    "tests/unit/named.test.ts": `const run = (name: string) => resolve(import.meta.dir, "..", "fixtures", "eval", \`\${name}.json\`);\n${body("test")}`,
    "tests/unit/slashed.test.ts": `const runs = new URL("../fixtures/eval/", import.meta.url);\n${body("test")}`,
    "tests/unit/listed.test.ts": `const runs = join(REPO, "tests/fixtures/eval");\n${body("test")}`,
    "tests/unit/sibling.test.ts": `const runs = new URL("../fixtures/evaluated/", import.meta.url);\n${body("test")}`,
    "tests/e2e/helped.test.ts": `import { effect0 } from "../lib/effect";\n${body("test")}`,
  });
  const baseline = await coverageBaseline(repo, [
    { testFile: "tests/unit/covered.test.ts", sources: ["src/covered.ts"] },
    { testFile: "tests/unit/other.test.ts", sources: ["src/other.ts"] },
    { testFile: "tests/unit/joined.test.ts", sources: ["src/joined.ts"] },
    { testFile: "tests/unit/named.test.ts", sources: ["src/named.ts"] },
    { testFile: "tests/unit/slashed.test.ts", sources: ["src/slashed.ts"] },
    { testFile: "tests/unit/listed.test.ts", sources: ["src/listed.ts"] },
    { testFile: "tests/unit/sibling.test.ts", sources: ["src/sibling.ts"] },
  ]);
  return { repo, base, baseline };
}

test("a changed helper pulls in the covered sources of every unit test that imports it, directly or through another helper", async () => {
  const { repo, base, baseline } = await helpedRepo();
  await repo.write({ "tests/lib/effect.ts": body("weakened") });

  const scope = await scopeOf(repo, base, baseline);

  expect(sorted(scope["SCOPE"])).toEqual(["src/covered.ts", "src/other.ts"]);
  expect(sorted(scope["STALE_TESTS"])).toEqual(["tests/unit/covered.test.ts", "tests/unit/other.test.ts"]);
});

test("a changed fixture pulls in the covered sources of every unit test that names it or its directory, in segments or with a trailing slash", async () => {
  const { repo, base, baseline } = await helpedRepo();
  await repo.write({ "tests/fixtures/eval/run.json": '{"weakened":true}\n' });

  const scope = await scopeOf(repo, base, baseline);

  expect(sorted(scope["SCOPE"])).toEqual(["src/joined.ts", "src/listed.ts", "src/named.ts", "src/slashed.ts"]);
});

test("a changed helper no unit test imports leaves the scope empty even with no baseline report", async () => {
  const { repo, base } = await helpedRepo();
  await repo.write({ "tests/lib/unused.ts": body("weakened") });

  expect(await scopeOf(repo, base)).toEqual(NOTHING);
});

test("a changed helper with no baseline report fails rather than scoping nothing", async () => {
  const { repo, base } = await helpedRepo();
  await repo.write({ "tests/lib/tree.ts": body("weakened") });

  const done = await scopeRun(repo, base);

  expect(done.exitCode).toBe(2);
  expect(done.text).toContain("mutation-scope: tests/unit/other.test.ts changed, but no baseline report says which sources they cover");
});

async function preloadedRepo(): Promise<{ repo: FixtureRepo; base: string; baseline: string }> {
  const { repo, base } = await repoWith({
    "src/covered.ts": body("covered"),
    "src/other.ts": body("other"),
    "bunfig.toml": '[test]\nroot = "tests"\npreload = ["./tests/lib/preload.ts"]\n',
    "tests/lib/preload.ts": `const { setup0 } = await import("./setup");\n${body("preload")}`,
    "tests/lib/setup.ts": body("setup"),
    "tests/unit/covered.test.ts": body("test"),
    "tests/unit/other.test.ts": body("test"),
    "tests/unit/plain.test.ts": body("test"),
  });
  const baseline = await coverageBaseline(repo, [
    { testFile: "tests/unit/covered.test.ts", sources: ["src/covered.ts"] },
    { testFile: "tests/unit/other.test.ts", sources: ["src/other.ts"] },
    { testFile: "tests/unit/plain.test.ts", sources: ["src/plain.ts"] },
  ]);
  return { repo, base, baseline };
}

const EVERY_UNIT_TEST = ["tests/unit/covered.test.ts", "tests/unit/other.test.ts", "tests/unit/plain.test.ts"];

test("a changed preload pulls in the covered sources of every unit test that still exist", async () => {
  const { repo, base, baseline } = await preloadedRepo();
  await repo.write({ "tests/lib/preload.ts": body("weakened") });

  const scope = await scopeOf(repo, base, baseline);

  expect(scope["SCOPE"]).toBe("src/covered.ts,src/other.ts");
  expect(sorted(scope["STALE_TESTS"])).toEqual(EVERY_UNIT_TEST);
});

test("a changed helper the preload imports pulls in the covered sources of every unit test", async () => {
  const { repo, base, baseline } = await preloadedRepo();
  await repo.write({ "tests/lib/setup.ts": body("weakened") });

  const scope = await scopeOf(repo, base, baseline);

  expect(scope["SCOPE"]).toBe("src/covered.ts,src/other.ts");
  expect(sorted(scope["STALE_TESTS"])).toEqual(EVERY_UNIT_TEST);
});

test("dropping a preload from the list pulls in the covered sources of every unit test", async () => {
  const { repo, base, baseline } = await preloadedRepo();
  await repo.write({ "bunfig.toml": '[test]\nroot = "tests"\n' });

  const scope = await scopeOf(repo, base, baseline);

  expect(scope["SCOPE"]).toBe("src/covered.ts,src/other.ts");
  expect(sorted(scope["STALE_TESTS"])).toEqual(EVERY_UNIT_TEST);
});

async function preloadedOutsideTests(changed: string): Promise<Record<string, string>> {
  const { repo, base } = await repoWith({
    "src/covered.ts": body("covered"),
    "src/clock.ts": body("clock"),
    "bunfig.toml": '[test]\npreload = "./test-setup.ts"\n',
    "test-setup.ts": `import { clock0 } from "./src/clock.ts";\n${body("setup")}`,
    "tests/unit/covered.test.ts": body("test"),
  });
  const baseline = await coverageBaseline(repo, [{ testFile: "tests/unit/covered.test.ts", sources: ["src/covered.ts"] }], ["src/clock.ts"]);
  await repo.write({ [changed]: body("weakened") });
  return scopeOf(repo, base, baseline);
}

test("a preload outside tests, and a source file it imports, each pull in the covered sources of every unit test", async () => {
  expect(await preloadedOutsideTests("test-setup.ts")).toEqual({ SCOPE: "src/covered.ts", STALE_TESTS: "tests/unit/covered.test.ts" });
  expect(await preloadedOutsideTests("src/clock.ts")).toEqual({ SCOPE: "src/clock.ts,src/covered.ts", STALE_TESTS: "tests/unit/covered.test.ts" });
});

test("an e2e-only pull request has an empty scope even with no baseline report", async () => {
  const { repo, base } = await repoWith({ "src/kept.ts": body("kept"), "tests/e2e/kept.test.ts": body("test") });
  await repo.write({ "tests/e2e/kept.test.ts": body("weakened") });

  expect(await scopeOf(repo, base)).toEqual(NOTHING);
});

test("an e2e test beside a changed source scopes the source alone and marks no test changed", async () => {
  const { repo, base } = await repoWith({ "src/kept.ts": body("kept"), "tests/e2e/kept.test.ts": body("test") });
  await repo.write({ "tests/e2e/kept.test.ts": body("weakened"), "src/kept.ts": body("kept") + "export const more = 1;\n" });

  expect(await scopeOf(repo, base)).toEqual({ ...NOTHING, SCOPE: "src/kept.ts" });
});
