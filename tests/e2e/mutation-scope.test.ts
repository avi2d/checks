import { $ } from "bun";
import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseWorkflow, stepNamed } from "../lib/workflow.ts";
import { fakeActions, type FakeRun } from "./lib/fake-actions.ts";
import { CHECKOUT, fixtureRepos, ran, scratchDirs, type FixtureRepo, type Ran } from "./lib/fixture-repo.ts";

// Scratch git repos and the scope script run past bun's 5s default on a loaded machine.
setDefaultTimeout(30_000);

const open = fixtureRepos("checks-mutation-scope-");
const scratch = scratchDirs();
const SCOPE = join(CHECKOUT, "scripts", "mutation-scope.sh");

const body = (name: string): string => Array.from({ length: 20 }, (_, line) => `export const ${name}${line} = ${line};\n`).join("");

async function repoWith(files: Readonly<Record<string, string>>): Promise<{ repo: FixtureRepo; base: string }> {
  const repo = await open({});
  await repo.write(files);
  const base = await repo.commit("base");
  return { repo, base };
}

async function scopeOf(repo: FixtureRepo, base: string, baseline = join(repo.dir, "no-baseline.json")): Promise<Record<string, string>> {
  await repo.commit("head");
  const done = await ran($`sh ${SCOPE} ${base} ${baseline}`.cwd(repo.dir));
  expect(done.exitCode).toBe(0);
  return Object.fromEntries(
    done.text
      .trim()
      .split("\n")
      .filter((line) => /^(SCOPE|BASE_SCOPE|STALE_TESTS)=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

type Link = { readonly testFile: string; readonly sources: string[]; readonly killsOnly?: boolean };

async function coverageBaseline(repo: FixtureRepo, links: readonly Link[]): Promise<string> {
  const ids = new Map(links.map(({ testFile }, index) => [testFile, `${index}`] as const));
  const testFiles = Object.fromEntries([...ids].map(([testFile, id]) => [testFile, { tests: [{ id, name: testFile }] }]));
  const bySource = new Map<string, Array<{ coveredBy: string[]; killedBy: string[] }>>();
  for (const { testFile, sources, killsOnly } of links) {
    const id = ids.get(testFile) ?? "";
    for (const source of sources) {
      const mutants = bySource.get(source) ?? [];
      mutants.push(killsOnly === true ? { coveredBy: [], killedBy: [id] } : { coveredBy: [id], killedBy: [id] });
      bySource.set(source, mutants);
    }
  }
  const files = Object.fromEntries([...bySource].map(([source, mutants]) => [source, { source: body("value"), mutants }]));
  const path = join(repo.dir, "baseline.json");
  await repo.write({ "baseline.json": JSON.stringify({ files, testFiles }) });
  return path;
}

type SharedMutant = { readonly source: string; readonly coveredBy: string[]; readonly killedBy: string[] };

async function sharedMutantBaseline(repo: FixtureRepo, mutants: readonly SharedMutant[]): Promise<string> {
  const order = [...new Set(mutants.flatMap((mutant) => [...mutant.coveredBy, ...mutant.killedBy]))].sort();
  const ids = new Map(order.map((testFile, index) => [testFile, `${index}`] as const));
  const testFiles = Object.fromEntries(order.map((testFile) => [testFile, { tests: [{ id: ids.get(testFile), name: testFile }] }]));
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

  expect(scope["SCOPE"]?.split(",").sort()).toEqual(["src/covered.ts", "src/other.ts"]);
  expect(scope["BASE_SCOPE"]?.split(",").sort()).toEqual(["src/covered.ts", "src/other.ts"]);
  expect(scope["STALE_TESTS"]?.split(",").sort()).toEqual(["tests/unit/covered.test.ts", "tests/unit/other.test.ts"]);
});

test("a changed fixture pulls in the covered sources of every unit test that names it or its directory, in segments or with a trailing slash", async () => {
  const { repo, base, baseline } = await helpedRepo();
  await repo.write({ "tests/fixtures/eval/run.json": '{"weakened":true}\n' });

  const scope = await scopeOf(repo, base, baseline);

  const readers = ["src/joined.ts", "src/listed.ts", "src/named.ts", "src/slashed.ts"];
  expect(scope["SCOPE"]?.split(",").sort()).toEqual(readers);
  expect(scope["BASE_SCOPE"]?.split(",").sort()).toEqual(readers);
});

test("a changed helper no unit test imports leaves the scope empty even with no baseline report", async () => {
  const { repo, base } = await helpedRepo();
  await repo.write({ "tests/lib/unused.ts": body("weakened") });

  expect(await scopeOf(repo, base)).toEqual({ SCOPE: "", BASE_SCOPE: "", STALE_TESTS: "" });
});

test("a deleted test still pulls its covered source into scope", async () => {
  const { repo, base, baseline } = await helpedRepo();
  await rm(join(repo.dir, "tests/unit/covered.test.ts"));

  const scope = await scopeOf(repo, base, baseline);

  expect(scope["SCOPE"]).toBe("src/covered.ts");
});

test("a changed test with no baseline report fails rather than scoping nothing", async () => {
  const { repo, base } = await helpedRepo();
  await repo.write({ "tests/lib/tree.ts": body("weakened") });
  await repo.commit("head");

  const done = await ran($`sh ${SCOPE} ${base} ${join(repo.dir, "no-baseline.json")}`.cwd(repo.dir));

  expect(done.exitCode).toBe(1);
  expect(done.text).toContain("mutation-scope: tests/unit/other.test.ts changed, but no baseline report");
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

  const scope = await scopeOf(repo, base, baseline);

  expect(scope["SCOPE"]).toBe("src/shared.ts");
  expect(scope["BASE_SCOPE"]).toBe("src/shared.ts");
  expect(scope["STALE_TESTS"]).toBe("");
});

test("a changed source scopes directly, and an added one only at the head", async () => {
  const { repo, base } = await repoWith({ "src/kept.ts": body("kept") });
  await repo.write({ "src/kept.ts": body("kept") + "export const more = 1;\n", "src/fresh.ts": body("fresh") });

  const scope = await scopeOf(repo, base);

  expect(scope["SCOPE"]?.split(",").sort()).toEqual(["src/fresh.ts", "src/kept.ts"]);
  expect(scope["BASE_SCOPE"]).toBe("src/kept.ts");
});

const WORKFLOW = join(CHECKOUT, ".github/workflows/mutation.yml");

async function runStep(name: string, cwd: string, env: Readonly<Record<string, string>>): Promise<Ran> {
  const step = stepNamed(parseWorkflow(await Bun.file(WORKFLOW).text()), name);
  return ran($`bash -e -c ${step.run}`.cwd(cwd).env({ ...process.env, ...step.env, ...env }));
}

// A full run uploads the report alone as its full artifact; a run from before full baselines uploads only the incremental one.
type DispatchedRun = { readonly id: number; readonly report: string; readonly full: boolean };

function artifactsOf({ id, report, full }: DispatchedRun): FakeRun["artifacts"] {
  const incremental = { id: id * 10, name: "mutation-baseline", expired: false, files: { "mutation/mutation.json": report, "stryker-incremental.json": "{}" } };
  const fullOnly = { id: id * 10 + 1, name: "mutation-baseline-full", expired: false, files: { "mutation.json": report } };
  return full ? [incremental, fullOnly] : [incremental];
}

async function selectScopeStep(repo: FixtureRepo, newestFirst: readonly DispatchedRun[], listFails = false): Promise<Ran & { readonly env: string }> {
  const home = await scratch("checks-mutation-scope-runner-");
  const createdAt = (index: number): string => new Date(Date.UTC(2026, 9, 10 - index)).toISOString();
  const runs = newestFirst.map((run, index) => ({ databaseId: run.id, event: "workflow_dispatch", createdAt: createdAt(index), artifacts: artifactsOf(run) }));
  const fake = await fakeActions(home, 1, runs, { listFails });
  await symlink(join(CHECKOUT, "scripts"), join(repo.dir, "scripts"));
  await mkdir(join(repo.dir, "src", "testing"), { recursive: true });
  await symlink(join(CHECKOUT, "src", "testing", "mutation-baseline.ts"), join(repo.dir, "src", "testing", "mutation-baseline.ts"));
  const githubEnv = join(home, "github-env");
  await writeFile(githubEnv, "");
  const done = await runStep("Select mutation scope", repo.dir, {
    ...fake.env,
    GITHUB_BASE_REF: "main",
    GITHUB_ENV: githubEnv,
    HOME: home,
    RUNNER_TEMP: home,
  });
  return { ...done, env: await readFile(githubEnv, "utf8") };
}

async function restoredMutantPullRequest(): Promise<{ repo: FixtureRepo; full: string; incremental: string }> {
  const { repo, base } = await repoWith({
    "src/shared.ts": body("shared"),
    "tests/unit/first.test.ts": body("first"),
    "tests/unit/second.test.ts": body("second"),
  });
  const read = async (path: string): Promise<string> => readFile(path, "utf8");
  const full = await read(
    await sharedMutantBaseline(repo, [
      { source: "src/shared.ts", coveredBy: ["tests/unit/first.test.ts", "tests/unit/second.test.ts"], killedBy: ["tests/unit/first.test.ts"] },
    ]),
  );
  const incremental = await read(
    await sharedMutantBaseline(repo, [{ source: "src/shared.ts", coveredBy: [], killedBy: ["tests/unit/first.test.ts"] }]),
  );
  await rm(join(repo.dir, "baseline.json"));
  await repo.write({ "tests/unit/second.test.ts": body("weakened") });
  await repo.commit("head");
  await $`git update-ref refs/remotes/origin/main ${base}`.cwd(repo.dir).quiet();
  return { repo, full, incremental };
}

test("the scope step reads the full baseline of the newest hand-started run on main", async () => {
  const { repo, full, incremental } = await restoredMutantPullRequest();

  const done = await selectScopeStep(repo, [
    { id: 3, report: full, full: true },
    { id: 2, report: incremental, full: true },
  ]);

  expect(done.exitCode).toBe(0);
  expect(done.env).toContain("SCOPE=src/shared.ts\n");
});

test("the scope step fails a changed test when the newest hand-started run on main has no full baseline", async () => {
  const { repo, incremental } = await restoredMutantPullRequest();

  const done = await selectScopeStep(repo, [{ id: 3, report: incremental, full: false }]);

  expect(done.exitCode).not.toBe(0);
  expect(done.text).toContain("mutation-scope: tests/unit/second.test.ts changed, but no baseline report");
  expect(done.env).not.toContain("SCOPE=");
});

test("the scope step fails when the baseline query fails rather than scoping without a baseline", async () => {
  const { repo, full } = await restoredMutantPullRequest();

  const done = await selectScopeStep(repo, [{ id: 3, report: full, full: true }], true);

  expect(done.exitCode).not.toBe(0);
  expect(done.text).toContain("gh: HTTP 502 listing runs");
  expect(done.env).not.toContain("SCOPE=");
});

type HeadReport = { readonly files: Readonly<Record<string, { readonly mutants: ReadonlyArray<{ readonly replacement: string; readonly status: string }> }>> };

const names = (input: readonly string[]): string => `${JSON.stringify({ input, expected: ["ab"] })}\n`;

async function fixtureReadingRepo(): Promise<{ repo: FixtureRepo; base: string }> {
  const { repo, base } = await repoWith({
    ".gitignore": "node_modules\nreports\n.stryker-tmp\n",
    "package.json": '{"name":"fixture-reader","type":"module","private":true}\n',
    "stryker.conf.mjs": `export default ${JSON.stringify({
      plugins: ["@stryker-mutator/*", "@hughescr/stryker-bun-runner"],
      testRunner: "bun",
      coverageAnalysis: "perTest",
      reporters: ["json"],
      bun: { testFiles: ["tests/unit/kept.test.ts"] },
      concurrency: 1,
    })};\n`,
    "src/kept.ts": 'export const kept = (names: string[]) => names.filter((name) => name.startsWith("a"));\n',
    "tests/fixtures/kept/names.json": names(["ab", "cd"]),
    "tests/unit/kept.test.ts": [
      'import { expect, test } from "bun:test";',
      'import { join } from "node:path";',
      'import { kept } from "../../src/kept.ts";',
      "",
      'const names = await Bun.file(join(import.meta.dir, "..", "fixtures", "kept", "names.json")).json();',
      "",
      'test("kept names start with a", () => {',
      "  expect(kept(names.input)).toEqual(names.expected);",
      "});",
      "",
    ].join("\n"),
  });
  await symlink(join(CHECKOUT, "node_modules"), join(repo.dir, "node_modules"));
  return { repo, base };
}

test("the head run retests a mutant whose killing test reads a fixture the pull request weakens", async () => {
  const { repo, base } = await fixtureReadingRepo();
  const stryker = $`bunx stryker run --incremental --ignoreStatic --mutate src/kept.ts`.cwd(repo.dir);
  expect((await ran(stryker)).exitCode).toBe(0);
  const runnerTemp = await scratch("checks-mutation-runner-");
  await mkdir(join(runnerTemp, "mutation-base"));
  await rename(join(repo.dir, "reports"), join(runnerTemp, "mutation-base", "reports"));
  const baseline = join(runnerTemp, "mutation-base", "reports", "mutation", "mutation.json");
  await repo.write({ "tests/fixtures/kept/names.json": names(["ab"]) });

  const scope = await scopeOf(repo, base, baseline);
  const head = await runStep("Build scope report at head", repo.dir, { ...scope, RUNNER_TEMP: runnerTemp });

  expect(head.exitCode).toBe(0);
  const report: HeadReport = await Bun.file(join(repo.dir, "reports", "mutation", "mutation.json")).json();
  const unfiltered = report.files["src/kept.ts"]?.mutants.find((mutant) => mutant.replacement === "names");
  expect(unfiltered?.status).toBe("Survived");
}, 120_000);
