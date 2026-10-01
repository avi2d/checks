import { $ } from "bun";
import { expect, setDefaultTimeout, test } from "bun:test";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseWorkflow, stepNamed } from "../lib/workflow.ts";
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
      .filter((line) => line.startsWith("SCOPE=") || line.startsWith("BASE_SCOPE="))
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

  expect(await scopeOf(repo, base)).toEqual({ SCOPE: "", BASE_SCOPE: "" });
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
});

test("a changed source scopes directly, and an added one only at the head", async () => {
  const { repo, base } = await repoWith({ "src/kept.ts": body("kept") });
  await repo.write({ "src/kept.ts": body("kept") + "export const more = 1;\n", "src/fresh.ts": body("fresh") });

  const scope = await scopeOf(repo, base);

  expect(scope["SCOPE"]?.split(",").sort()).toEqual(["src/fresh.ts", "src/kept.ts"]);
  expect(scope["BASE_SCOPE"]).toBe("src/kept.ts");
});

// Answers `gh run list` from runs-<event>.json and `gh run download` from report-<id>.json, and fails a list whose fail-<event> exists.
const FAKE_GH = `#!/bin/sh
here="$(dirname "$0")"
case "$1 $2" in
  "run list")
    while [ $# -gt 0 ]; do case "$1" in --event) event="$2"; shift;; --jq) filter="$2"; shift;; esac; shift; done
    if [ -f "$here/fail-$event" ]; then echo "gh: HTTP 502 listing $event runs" >&2; exit 1; fi
    if [ -f "$here/runs-$event.json" ]; then jq -c "$filter" "$here/runs-$event.json"; fi;;
  "run download")
    id="$3"
    while [ $# -gt 0 ]; do case "$1" in --dir) dir="$2"; shift;; esac; shift; done
    mkdir -p "$dir/mutation" && cp "$here/report-$id.json" "$dir/mutation/mutation.json";;
  *) echo "fake gh: unknown call $*" >&2; exit 1;;
esac
`;

type BaselineRun = { readonly event: "schedule" | "workflow_dispatch"; readonly id: number; readonly createdAt: string; readonly report: string };

async function selectScopeStep(repo: FixtureRepo, runs: readonly BaselineRun[], failing: readonly string[] = []): Promise<Ran & { readonly env: string }> {
  const step = stepNamed(parseWorkflow(await Bun.file(join(CHECKOUT, ".github/workflows/mutation.yml")).text()), "Select mutation scope");
  const bin = await scratch("checks-mutation-scope-gh-");
  await writeFile(join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  for (const { event, id, createdAt, report } of runs) {
    await writeFile(join(bin, `runs-${event}.json`), JSON.stringify([{ databaseId: id, createdAt }]));
    await writeFile(join(bin, `report-${id}.json`), report);
  }
  for (const event of failing) await writeFile(join(bin, `fail-${event}`), "");
  await symlink(join(CHECKOUT, "scripts"), join(repo.dir, "scripts"));
  const githubEnv = join(bin, "github-env");
  await writeFile(githubEnv, "");
  const done = await ran(
    $`bash -e -c ${step.run}`
      .cwd(repo.dir)
      .env({ ...process.env, ...step.env, PATH: `${bin}:${process.env["PATH"] ?? ""}`, GITHUB_BASE_REF: "main", GITHUB_ENV: githubEnv }),
  );
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

test("the scope step reads the newer of the latest scheduled and hand-started baselines", async () => {
  const { repo, full, incremental } = await restoredMutantPullRequest();

  const done = await selectScopeStep(repo, [
    { event: "schedule", id: 3, createdAt: "2026-10-01T01:23:00Z", report: full },
    { event: "workflow_dispatch", id: 2, createdAt: "2026-09-30T12:00:00Z", report: incremental },
  ]);

  expect(done.exitCode).toBe(0);
  expect(done.env).toContain("SCOPE=src/shared.ts\n");
});

test("the scope step fails when a baseline query fails rather than reading the other event's older report", async () => {
  const { repo, full, incremental } = await restoredMutantPullRequest();

  const done = await selectScopeStep(
    repo,
    [
      { event: "schedule", id: 3, createdAt: "2026-10-01T01:23:00Z", report: full },
      { event: "workflow_dispatch", id: 2, createdAt: "2026-09-30T12:00:00Z", report: incremental },
    ],
    ["schedule"],
  );

  expect(done.exitCode).not.toBe(0);
  expect(done.text).toContain("gh: HTTP 502 listing schedule runs");
  expect(done.env).not.toContain("SCOPE=");
});
