import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeActions, type FakeOptions, type FakeRun } from "./lib/fake-actions.ts";
import { CHECKOUT, ran, type Ran, scratchDirs } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "testing", "mutation-baseline.ts");
const REPOSITORY_ID = 4242;
const SHELVES = join(".cache", "avi2dg-checks", "mutation-baseline", String(REPOSITORY_ID));

const scratch = scratchDirs();

type Runner = {
  readonly home: string;
  readonly run: (args: readonly string[], env?: Readonly<Record<string, string | undefined>>) => Promise<Ran>;
  readonly downloads: () => Promise<readonly string[]>;
  readonly calls: () => Promise<readonly string[]>;
  readonly read: (file: string) => Promise<string | undefined>;
  readonly shelf: (artifact: string) => Promise<readonly string[]>;
};

function baseline(id: number, name: string, tag: string, expired = false) {
  return { id, name, expired, files: { "stryker-incremental.json": `{"state":"${tag}"}`, "mutation/mutation.json": `{"report":"${tag}"}` } };
}

// A full artifact uploaded from the one path reports/mutation/mutation.json holds the report at its root and no state beside it.
function fullReport(id: number, tag: string) {
  return { id, name: "mutation-baseline-full", expired: false, files: { "mutation.json": `{"report":"${tag}"}` } };
}

// A full artifact uploaded from both baseline paths holds the report under mutation/ with the incremental state beside it.
function fullBaseline(id: number, tag: string) {
  return {
    id,
    name: "mutation-baseline-full",
    expired: false,
    files: { "mutation/mutation.json": `{"report":"${tag}"}`, "stryker-incremental.json": `{"state":"${tag}"}` },
  };
}

function run(databaseId: number, event: string, createdAt: string, artifacts: FakeRun["artifacts"], headSha?: string): FakeRun {
  return { databaseId, event, createdAt, ...(headSha === undefined ? {} : { headSha }), artifacts };
}

async function gitRunner(files: Readonly<Record<string, string>>, build: (sha: string) => readonly FakeRun[]): Promise<Runner & { readonly work: string }> {
  const home = await scratch("checks-mutation-baseline-git-");
  const work = join(home, "work");
  await mkdir(work);
  await $`git init -q -b main && git config user.email fixture@example.com && git config user.name Fixture`.cwd(work).quiet();
  await writeFile(join(work, "tracked.txt"), "base\n");
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(work, name.slice(0, Math.max(name.lastIndexOf("/"), 0))), { recursive: true });
    await writeFile(join(work, name), content);
  }
  await $`git add -A && git commit -qm base`.cwd(work).quiet();
  const sha = (await $`git rev-parse HEAD`.cwd(work).quiet()).stdout.toString().trim();
  const fake = await fakeActions(home, REPOSITORY_ID, build(sha));
  return {
    home,
    work,
    run: (args, env = {}) =>
      ran($`bun ${SCRIPT} ${args}`.cwd(work).env({ ...process.env, RUNNER_ENVIRONMENT: "self-hosted", GITHUB_RUN_ID: undefined, GITHUB_REPOSITORY_ID: String(REPOSITORY_ID), ...fake.env, HOME: home, ...env })),
    downloads: fake.downloads,
    calls: fake.calls,
    read: (file) => readFile(join(work, file), "utf8").catch(() => undefined),
    shelf: async (artifact) => (await readdir(join(home, SHELVES, artifact)).catch(() => [])).filter((entry) => !entry.startsWith(".")).sort(),
  };
}

// HOME holds the runner's cache, so each runner starts with an empty one.
async function selfHosted(runs: readonly FakeRun[], options: FakeOptions = {}): Promise<Runner> {
  const home = await scratch("checks-mutation-baseline-");
  const fake = await fakeActions(home, REPOSITORY_ID, runs, options);
  const work = join(home, "work");
  await mkdir(work);
  return {
    home,
    run: (args, env = {}) => ran($`bun ${SCRIPT} ${args}`.cwd(work).env({ ...process.env, RUNNER_ENVIRONMENT: "self-hosted", GITHUB_RUN_ID: undefined, GITHUB_REPOSITORY_ID: String(REPOSITORY_ID), ...fake.env, HOME: home, ...env })),
    downloads: fake.downloads,
    calls: fake.calls,
    read: (file) => readFile(join(work, file), "utf8").catch(() => undefined),
    shelf: async (artifact) => (await readdir(join(home, SHELVES, artifact)).catch(() => [])).filter((entry) => !entry.startsWith(".")).sort(),
  };
}

const MAIN_RUNS = [
  run(30, "pull_request", "2026-10-03T00:00:00Z", [baseline(300, "mutation-baseline", "pull request")]),
  run(20, "push", "2026-10-02T00:00:00Z", [baseline(200, "mutation-baseline", "newest push")]),
  run(10, "push", "2026-10-01T00:00:00Z", [baseline(100, "mutation-baseline", "older push")]),
];

test("a cache miss downloads the newest main run's baseline that is not a pull request's, restores both files and keeps the artifact in the cache", async () => {
  const runner = await selfHosted(MAIN_RUNS);

  const restored = await runner.run(["reports/stryker-incremental.json", "baseline/mutation.json"]);

  expect(restored).toEqual({ exitCode: 0, text: "mutation-baseline: downloaded it into the runner's cache, mutation-baseline artifact 200 from run 20\n" });
  expect(await runner.read("reports/stryker-incremental.json")).toBe('{"state":"newest push"}');
  expect(await runner.read("baseline/mutation.json")).toBe('{"report":"newest push"}');
  expect(await runner.downloads()).toHaveLength(1);
  expect(await runner.shelf("mutation-baseline")).toEqual(["200"]);
}, 30_000);

test("a cache hit on the artifact's id restores the same files without downloading again", async () => {
  const runner = await selfHosted(MAIN_RUNS);
  await runner.run(["first/stryker-incremental.json"]);

  const restored = await runner.run(["second/stryker-incremental.json", "second/mutation.json"]);

  expect(restored).toEqual({ exitCode: 0, text: "mutation-baseline: restored it from the runner's cache, mutation-baseline artifact 200 from run 20\n" });
  expect(await runner.read("second/stryker-incremental.json")).toBe('{"state":"newest push"}');
  expect(await runner.read("second/mutation.json")).toBe('{"report":"newest push"}');
  expect(await runner.downloads()).toHaveLength(1);
}, 30_000);

test("a newer baseline is downloaded past the stale entries, and the cache keeps only the newest two", async () => {
  const runner = await selfHosted(MAIN_RUNS);
  for (const stale of [100, 150]) {
    const entry = join(runner.home, SHELVES, "mutation-baseline", String(stale));
    await mkdir(entry, { recursive: true });
    await writeFile(join(entry, "stryker-incremental.json"), '{"state":"stale"}');
  }

  const restored = await runner.run(["reports/stryker-incremental.json"]);

  expect(restored.text).toBe("mutation-baseline: downloaded it into the runner's cache, mutation-baseline artifact 200 from run 20\n");
  expect(await runner.read("reports/stryker-incremental.json")).toBe('{"state":"newest push"}');
  expect(await runner.shelf("mutation-baseline")).toEqual(["150", "200"]);
}, 30_000);

test("a download older than the two cached ids still restores, and stays cached for the next job", async () => {
  const runner = await selfHosted(MAIN_RUNS);
  for (const newer of [250, 300]) {
    const entry = join(runner.home, SHELVES, "mutation-baseline", String(newer));
    await mkdir(entry, { recursive: true });
    await writeFile(join(entry, "stryker-incremental.json"), '{"state":"newer"}');
  }

  const downloaded = await runner.run(["first/stryker-incremental.json"]);
  const cached = await runner.run(["second/stryker-incremental.json"]);

  expect(downloaded).toEqual({ exitCode: 0, text: "mutation-baseline: downloaded it into the runner's cache, mutation-baseline artifact 200 from run 20\n" });
  expect(await runner.read("first/stryker-incremental.json")).toBe('{"state":"newest push"}');
  expect(cached).toEqual({ exitCode: 0, text: "mutation-baseline: restored it from the runner's cache, mutation-baseline artifact 200 from run 20\n" });
  expect(await runner.read("second/stryker-incremental.json")).toBe('{"state":"newest push"}');
  expect(await runner.downloads()).toHaveLength(1);
  expect(await runner.shelf("mutation-baseline")).toEqual(["200", "250", "300"]);
}, 30_000);

test("--full takes the newest scheduled or hand-started run whose full artifact downloads, and never a push's", async () => {
  const runner = await selfHosted([
    run(50, "push", "2026-10-05T00:00:00Z", [baseline(500, "mutation-baseline-full", "push")]),
    run(40, "workflow_dispatch", "2026-10-04T00:00:00Z", [baseline(400, "mutation-baseline-full", "expired dispatch", true)]),
    run(38, "schedule", "2026-10-03T18:00:00Z", [baseline(380, "mutation-baseline", "schedule without a full artifact")]),
    run(35, "workflow_dispatch", "2026-10-03T12:00:00Z", [baseline(350, "mutation-baseline-full", "dispatch")]),
    run(30, "schedule", "2026-10-03T00:00:00Z", [baseline(300, "mutation-baseline-full", "older schedule")]),
  ]);

  const restored = await runner.run(["--full", "full/mutation.json"]);

  expect(restored).toEqual({ exitCode: 0, text: "mutation-baseline: downloaded it into the runner's cache, mutation-baseline-full artifact 350 from run 35\n" });
  expect(await runner.read("full/mutation.json")).toBe('{"report":"dispatch"}');
  expect(await runner.shelf("mutation-baseline-full")).toEqual(["350"]);
}, 30_000);

test("--full restores the report a full artifact holds at its root, with no incremental state beside it, and then from the cache", async () => {
  const runner = await selfHosted([run(35, "workflow_dispatch", "2026-10-03T12:00:00Z", [fullReport(350, "root layout")])]);

  const downloaded = await runner.run(["--full", "full/mutation.json"]);
  const cached = await runner.run(["--full", "again/mutation.json"]);

  expect(downloaded).toEqual({ exitCode: 0, text: "mutation-baseline: downloaded it into the runner's cache, mutation-baseline-full artifact 350 from run 35\n" });
  expect(await runner.read("full/mutation.json")).toBe('{"report":"root layout"}');
  expect(cached).toEqual({ exitCode: 0, text: "mutation-baseline: restored it from the runner's cache, mutation-baseline-full artifact 350 from run 35\n" });
  expect(await runner.read("again/mutation.json")).toBe('{"report":"root layout"}');
  expect(await runner.downloads()).toHaveLength(1);
}, 30_000);

test("--full with an incremental destination restores the report and the state, and then from the cache", async () => {
  const runner = await gitRunner({}, (sha) => [run(35, "workflow_dispatch", "2026-10-03T12:00:00Z", [fullBaseline(350, "with state")], sha)]);

  const downloaded = await runner.run(["--full", "full/mutation.json", "full/stryker-incremental.json"]);
  const cached = await runner.run(["--full", "again/mutation.json", "again/stryker-incremental.json"]);

  expect(downloaded).toEqual({ exitCode: 0, text: "mutation-baseline: downloaded it into the runner's cache, mutation-baseline-full artifact 350 from run 35\n" });
  expect(await runner.read("full/mutation.json")).toBe('{"report":"with state"}');
  expect(await runner.read("full/stryker-incremental.json")).toBe('{"state":"with state"}');
  expect(cached).toEqual({ exitCode: 0, text: "mutation-baseline: restored it from the runner's cache, mutation-baseline-full artifact 350 from run 35\n" });
  expect(await runner.read("again/mutation.json")).toBe('{"report":"with state"}');
  expect(await runner.read("again/stryker-incremental.json")).toBe('{"state":"with state"}');
  expect(await runner.downloads()).toHaveLength(1);
}, 30_000);

test("--full with an incremental destination still restores the report when the artifact holds no state", async () => {
  const runner = await selfHosted([run(35, "workflow_dispatch", "2026-10-03T12:00:00Z", [fullReport(350, "root layout")])]);

  const restored = await runner.run(["--full", "full/mutation.json", "full/stryker-incremental.json"]);

  expect(restored.exitCode).toBe(0);
  expect(await runner.read("full/mutation.json")).toBe('{"report":"root layout"}');
  expect(await runner.read("full/stryker-incremental.json")).toBeUndefined();
}, 30_000);

function fullState(id: number, state: string, report = '{"report":"with state"}') {
  return { id, name: "mutation-baseline-full", expired: false, files: { "mutation.json": report, "stryker-incremental.json": state } };
}

test("--full restores the report and the state a one-directory upload holds at the artifact root", async () => {
  const runner = await gitRunner({}, (sha) => [run(35, "workflow_dispatch", "2026-10-03T12:00:00Z", [fullState(350, '{"state":"root layout"}', '{"report":"root layout"}')], sha)]);

  const restored = await runner.run(["--full", "full/mutation.json", "full/stryker-incremental.json"]);

  expect(restored).toEqual({ exitCode: 0, text: "mutation-baseline: downloaded it into the runner's cache, mutation-baseline-full artifact 350 from run 35\n" });
  expect(await runner.read("full/mutation.json")).toBe('{"report":"root layout"}');
  expect(await runner.read("full/stryker-incremental.json")).toBe('{"state":"root layout"}');
}, 30_000);

test("--full drops stale tests, changed sources, and static results from the restored state", async () => {
  const killed = { status: "Killed", coveredBy: ["0"], killedBy: ["1"] };
  const state = JSON.stringify({
    files: {
      "src/changed.ts": { mutants: [killed] },
      "src/other.ts": { mutants: [{ status: "Survived", static: true, coveredBy: [] }, killed] },
    },
    testFiles: { "tests/unit/a.test.ts": { tests: [{ id: "0" }] }, "tests/unit/b.test.ts": { tests: [{ id: "1" }] } },
  });
  const runner = await gitRunner(
    {
      "tests/unit/a.test.ts": 'import { helper } from "../helper";\nimport { expect, test } from "bun:test";\ntest("a", () => expect(helper).toBe(1));\n',
      "tests/unit/b.test.ts": 'import { expect, test } from "bun:test";\ntest("b", () => expect(1).toBe(1));\n',
      "tests/helper.ts": "export const helper = 1;\n",
      "src/changed.ts": "export const changed = 1;\n",
      "src/other.ts": "export const other = 1;\n",
    },
    (sha) => [run(35, "workflow_dispatch", "2026-10-03T12:00:00Z", [fullState(350, state)], sha)],
  );
  await writeFile(join(runner.work, "tests/helper.ts"), "export const helper = 2;\n");
  await writeFile(join(runner.work, "src/changed.ts"), "export const changed = 2;\n");
  await $`git add -A && git commit -qm weaken`.cwd(runner.work).quiet();

  const restored = await runner.run(["--full", "full/mutation.json", "full/stryker-incremental.json"]);

  expect(restored.exitCode).toBe(0);
  expect(restored.text).toContain("mutation-baseline: downloaded it into the runner's cache, mutation-baseline-full artifact 350 from run 35\n");
  expect(restored.text).toContain(
    "mutation-baseline: dropped tests/unit/a.test.ts src/changed.ts results src/other.ts results from the restored full state\n",
  );
  expect(await runner.read("full/mutation.json")).toBe('{"report":"with state"}');
  expect(JSON.parse((await runner.read("full/stryker-incremental.json")) ?? "")).toEqual({
    files: { "src/other.ts": { mutants: [killed] } },
    testFiles: { "tests/unit/b.test.ts": { tests: [{ id: "1" }] } },
  });
}, 30_000);

test("--full drops the restored state when the config changed since the full run", async () => {
  const runner = await gitRunner({}, (sha) => [run(35, "workflow_dispatch", "2026-10-03T12:00:00Z", [fullState(350, '{"testFiles":{}}')], sha)]);
  await writeFile(join(runner.work, "package.json"), '{"name":"fixture"}\n');
  await $`git add -A && git commit -qm config`.cwd(runner.work).quiet();

  const restored = await runner.run(["--full", "full/mutation.json", "full/stryker-incremental.json"]);

  expect(restored.exitCode).toBe(0);
  expect(restored.text).toContain("mutation-baseline: dropped the restored full state, package.json changed since run 35\n");
  expect(await runner.read("full/mutation.json")).toBe('{"report":"with state"}');
  expect(await runner.read("full/stryker-incremental.json")).toBeUndefined();
}, 30_000);

test("--full keeps the restored state when only the package.json version changed since the full run", async () => {
  const runner = await gitRunner({ "package.json": '{"name":"fixture","version":"1.0.0"}\n' }, (sha) => [
    run(35, "workflow_dispatch", "2026-10-03T12:00:00Z", [fullState(350, '{"testFiles":{}}')], sha),
  ]);
  await writeFile(join(runner.work, "package.json"), '{"name":"fixture","version":"1.0.1"}\n');
  await $`git add -A && git commit -qm release`.cwd(runner.work).quiet();

  const restored = await runner.run(["--full", "full/mutation.json", "full/stryker-incremental.json"]);

  expect(restored.exitCode).toBe(0);
  expect(restored.text).not.toContain("dropped the restored full state");
  expect(await runner.read("full/mutation.json")).toBe('{"report":"with state"}');
  expect(await runner.read("full/stryker-incremental.json")).toBe('{"testFiles":{}}');
}, 30_000);

test("--full drops the restored state when a package.json dependency changed since the full run", async () => {
  const runner = await gitRunner({ "package.json": '{"name":"fixture","version":"1.0.0"}\n' }, (sha) => [
    run(35, "workflow_dispatch", "2026-10-03T12:00:00Z", [fullState(350, '{"testFiles":{}}')], sha),
  ]);
  await writeFile(join(runner.work, "package.json"), '{"name":"fixture","version":"1.0.0","dependencies":{"left-pad":"1.0.0"}}\n');
  await $`git add -A && git commit -qm depend`.cwd(runner.work).quiet();

  const restored = await runner.run(["--full", "full/mutation.json", "full/stryker-incremental.json"]);

  expect(restored.exitCode).toBe(0);
  expect(restored.text).toContain("mutation-baseline: dropped the restored full state, package.json changed since run 35\n");
  expect(await runner.read("full/stryker-incremental.json")).toBeUndefined();
}, 30_000);

test("--full drops the restored state when a patch its patchedDependencies names changed since the full run", async () => {
  const runner = await gitRunner(
    {
      "package.json": '{"name":"fixture","patchedDependencies":{"left-pad@1.0.0":"vendor/left-pad.patch"}}\n',
      "vendor/left-pad.patch": "--- a/index.js\n",
    },
    (sha) => [run(35, "workflow_dispatch", "2026-10-03T12:00:00Z", [fullState(350, '{"testFiles":{}}')], sha)],
  );
  await writeFile(join(runner.work, "vendor/left-pad.patch"), "--- a/index.js\n+++ b/index.js\n");
  await $`git add -A && git commit -qm patch`.cwd(runner.work).quiet();

  const restored = await runner.run(["--full", "full/mutation.json", "full/stryker-incremental.json"]);

  expect(restored.exitCode).toBe(0);
  expect(restored.text).toContain("mutation-baseline: dropped the restored full state, vendor/left-pad.patch changed since run 35\n");
  expect(await runner.read("full/stryker-incremental.json")).toBeUndefined();
}, 30_000);

test("--full drops the restored state when the test preload changed since the full run", async () => {
  const runner = await gitRunner(
    { "bunfig.toml": '[test]\npreload = "./setup.ts"\n', "setup.ts": "export {};\n" },
    (sha) => [run(35, "workflow_dispatch", "2026-10-03T12:00:00Z", [fullState(350, '{"testFiles":{}}')], sha)],
  );
  await writeFile(join(runner.work, "bunfig.toml"), '[test]\npreload = "./other.ts"\n');
  await $`git add -A && git commit -qm preload`.cwd(runner.work).quiet();

  const restored = await runner.run(["--full", "full/mutation.json", "full/stryker-incremental.json"]);

  expect(restored.exitCode).toBe(0);
  expect(restored.text).toContain("mutation-baseline: dropped the restored full state, the [test] preload list in bunfig.toml changed since run 35\n");
  expect(await runner.read("full/stryker-incremental.json")).toBeUndefined();
}, 30_000);

test("--full fails the restore when the restored state does not parse", async () => {
  const runner = await gitRunner({}, (sha) => [run(35, "workflow_dispatch", "2026-10-03T12:00:00Z", [fullState(350, "not json")], sha)]);

  const restored = await runner.run(["--full", "full/mutation.json", "full/stryker-incremental.json"]);

  expect(restored.exitCode).toBe(2);
  expect(restored.text).toContain("mutation-baseline: full/stryker-incremental.json is not a Stryker incremental state with its test files\n");
  expect(await runner.read("full/mutation.json")).toBe('{"report":"with state"}');
}, 30_000);

test("--full passes over an artifact without the report and downloads no run after the first that holds one", async () => {
  const runner = await selfHosted([
    run(40, "workflow_dispatch", "2026-10-04T00:00:00Z", [{ id: 400, name: "mutation-baseline-full", expired: false, files: { "stryker-incremental.json": "{}" } }]),
    run(35, "schedule", "2026-10-03T12:00:00Z", [fullReport(350, "first with a report")]),
    run(30, "workflow_dispatch", "2026-10-03T00:00:00Z", [fullReport(300, "older")]),
  ]);

  const restored = await runner.run(["--full", "full/mutation.json"]);

  expect(restored.text).toBe("mutation-baseline: downloaded it into the runner's cache, mutation-baseline-full artifact 350 from run 35\n");
  expect(await runner.read("full/mutation.json")).toBe('{"report":"first with a report"}');
  expect((await runner.downloads()).map((call) => call.split(" ")[2])).toEqual(["40", "35"]);
}, 30_000);

test("two jobs that miss the cache together both restore, and the runner keeps one entry", async () => {
  const runner = await selfHosted(MAIN_RUNS, { downloadsMeet: 2 });

  const [first, second] = await Promise.all([runner.run(["first/stryker-incremental.json"]), runner.run(["second/stryker-incremental.json"])]);

  const downloaded = "mutation-baseline: downloaded it into the runner's cache, mutation-baseline artifact 200 from run 20\n";
  expect([first, second]).toEqual([{ exitCode: 0, text: downloaded }, { exitCode: 0, text: downloaded }]);
  expect(await runner.read("first/stryker-incremental.json")).toBe('{"state":"newest push"}');
  expect(await runner.read("second/stryker-incremental.json")).toBe('{"state":"newest push"}');
  expect(await readdir(join(runner.home, SHELVES, "mutation-baseline"))).toEqual(["200"]);
}, 30_000);

test("an entry that lost its state file is downloaded past, and every job on the runner still restores", async () => {
  const runner = await selfHosted(MAIN_RUNS);
  const damaged = join(runner.home, SHELVES, "mutation-baseline", "200", "mutation");
  await mkdir(damaged, { recursive: true });
  await writeFile(join(damaged, "mutation.json"), '{"report":"left behind"}');

  const downloaded = "mutation-baseline: downloaded it into the runner's cache, mutation-baseline artifact 200 from run 20\n";
  for (const job of ["first", "second"]) {
    expect(await runner.run([`${job}/stryker-incremental.json`, `${job}/mutation.json`])).toEqual({ exitCode: 0, text: downloaded });
    expect(await runner.read(`${job}/stryker-incremental.json`)).toBe('{"state":"newest push"}');
    expect(await runner.read(`${job}/mutation.json`)).toBe('{"report":"newest push"}');
  }
}, 30_000);

test("with no baseline to restore it writes nothing and still exits 0", async () => {
  const none = await selfHosted([run(30, "pull_request", "2026-10-03T00:00:00Z", [baseline(300, "mutation-baseline", "pull request")])]);
  const restored = await none.run(["reports/stryker-incremental.json", "baseline/mutation.json"]);
  expect(restored).toEqual({ exitCode: 0, text: "mutation-baseline: no successful main run holds a mutation-baseline artifact, so nothing was restored\n" });
  expect(await none.read("reports/stryker-incremental.json")).toBeUndefined();
  expect(await none.read("baseline/mutation.json")).toBeUndefined();

  const unfinished = await selfHosted([run(20, "push", "2026-10-02T00:00:00Z", []), ...MAIN_RUNS.slice(2)]);
  const older = await unfinished.run(["reports/stryker-incremental.json"]);
  expect(older.text).toBe("mutation-baseline: no successful main run holds a mutation-baseline artifact, so nothing was restored\n");
  expect(await unfinished.read("reports/stryker-incremental.json")).toBeUndefined();
}, 30_000);

test("a GitHub-hosted runner downloads the baseline without writing a cache", async () => {
  const runner = await selfHosted(MAIN_RUNS);

  const restored = await runner.run(["reports/stryker-incremental.json"], { RUNNER_ENVIRONMENT: "github-hosted" });

  expect(restored.text).toBe("mutation-baseline: downloaded it, mutation-baseline artifact 200 from run 20\n");
  expect(await runner.read("reports/stryker-incremental.json")).toBe('{"state":"newest push"}');
  expect(await readdir(join(runner.home, ".cache")).catch(() => [])).toEqual([]);
}, 30_000);

test("with HOME unset it says the runner cache is disabled, then downloads the baseline without writing a cache", async () => {
  const runner = await selfHosted(MAIN_RUNS);

  const restored = await runner.run(["reports/stryker-incremental.json"], { HOME: undefined });

  expect(restored).toEqual({
    exitCode: 0,
    text:
      "mutation-baseline: downloaded it, mutation-baseline artifact 200 from run 20\n" +
      "mutation-baseline: the runner cache is disabled because HOME is unset, so the baseline is downloaded\n",
  });
  expect(await runner.read("reports/stryker-incremental.json")).toBe('{"state":"newest push"}');
  expect(await readdir(join(runner.home, ".cache")).catch(() => [])).toEqual([]);
}, 30_000);

test("a missing destination prints the usage and exits 2", async () => {
  const runner = await selfHosted(MAIN_RUNS);
  expect(await runner.run(["--full"])).toEqual({
    exitCode: 2,
    text:
      "checks-mutation-baseline: usage: checks-mutation-baseline <incremental-dest> [mutation-json-dest] | --full <mutation-json-dest> [incremental-dest] | " +
      "--save <incremental-src> [mutation-json-src] | --slim <mutation-json-src> <dest> | --prune [--dry-run]\n",
  });
  expect(await runner.run(["--full", "full/mutation.json", "full/stryker-incremental.json", "extra"])).toEqual({
    exitCode: 2,
    text:
      "checks-mutation-baseline: usage: checks-mutation-baseline <incremental-dest> [mutation-json-dest] | --full <mutation-json-dest> [incremental-dest] | " +
      "--save <incremental-src> [mutation-json-src] | --slim <mutation-json-src> <dest> | --prune [--dry-run]\n",
  });
}, 30_000);

// The restore takes run 20's baseline and run 35's full report, so the prune keeps artifacts 200 and 350.
const PRUNE_RUNS = [
  run(35, "workflow_dispatch", "2026-10-04T00:00:00Z", [fullReport(350, "newest full")]),
  run(30, "pull_request", "2026-10-03T00:00:00Z", [baseline(300, "mutation-baseline", "pull request")]),
  run(25, "schedule", "2026-10-02T12:00:00Z", [fullReport(250, "older full")]),
  run(20, "push", "2026-10-02T00:00:00Z", [baseline(200, "mutation-baseline", "newest push")]),
  run(10, "push", "2026-10-01T00:00:00Z", [baseline(100, "mutation-baseline", "older push"), { id: 999, name: "other", expired: false, files: {} }]),
];

function deleted(calls: readonly string[]): readonly number[] {
  return calls
    .flatMap((call) => {
      const matched = /artifacts\/(\d+)$/.exec(call);
      return matched === null ? [] : [Number(matched[1])];
    })
    .sort((one, other) => one - other);
}

test("--prune deletes every superseded baseline but the newest of each, and never another name", async () => {
  const runner = await selfHosted(PRUNE_RUNS);

  const pruned = await runner.run(["--prune"]);

  expect(pruned).toEqual({
    exitCode: 0,
    text: "mutation-baseline: deleted artifacts 100, 250, 300; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35\n",
  });
  expect(deleted(await runner.calls())).toEqual([100, 250, 300]);
  const again = await runner.run(["--prune", "--dry-run"]);
  expect(again.text).toBe("mutation-baseline: dry run, nothing to delete; would keep mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35\n");
}, 30_000);

test("--prune --dry-run lists what would go and deletes nothing", async () => {
  const runner = await selfHosted(PRUNE_RUNS);

  const dried = await runner.run(["--prune", "--dry-run"]);

  expect(dried).toEqual({
    exitCode: 0,
    text: "mutation-baseline: dry run, would delete artifacts 100, 250, 300; would keep mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35\n",
  });
  expect(deleted(await runner.calls())).toEqual([]);
}, 30_000);

test("--prune keeps the uploads of the run it runs in, which the restore takes once that run succeeds", async () => {
  const runner = await selfHosted(
    [run(40, "schedule", "2026-10-05T00:00:00Z", [baseline(400, "mutation-baseline", "this run"), fullReport(450, "this run's full")]), ...PRUNE_RUNS],
    { inProgress: [40] },
  );

  const pruned = await runner.run(["--prune"], { GITHUB_RUN_ID: "40" });

  expect(pruned).toEqual({
    exitCode: 0,
    text:
      "mutation-baseline: deleted artifacts 100, 250, 300; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35, " +
      "mutation-baseline artifact 400 from run 40, mutation-baseline-full artifact 450 from run 40\n",
  });
  expect(deleted(await runner.calls())).toEqual([100, 250, 300]);
}, 30_000);

test("--prune on a repository's first run keeps both of that run's uploads", async () => {
  const runner = await selfHosted([run(40, "workflow_dispatch", "2026-10-05T00:00:00Z", [baseline(400, "mutation-baseline", "first"), fullReport(450, "first full")])], {
    inProgress: [40],
  });

  const pruned = await runner.run(["--prune"], { GITHUB_RUN_ID: "40" });

  expect(pruned).toEqual({
    exitCode: 0,
    text: "mutation-baseline: nothing to delete; kept mutation-baseline artifact 400 from run 40, mutation-baseline-full artifact 450 from run 40\n",
  });
  expect(deleted(await runner.calls())).toEqual([]);
}, 30_000);

test("--prune deletes nothing and exits 2 when a run's artifact lookup fails", async () => {
  const runner = await selfHosted(PRUNE_RUNS, { failing: ["api repos/{owner}/{repo}/actions/runs/20/artifacts"] });

  const pruned = await runner.run(["--prune"]);

  expect(pruned).toEqual({
    exitCode: 2,
    text: "checks-mutation-baseline: gh api repos/{owner}/{repo}/actions/runs/20/artifacts?name=mutation-baseline: gh: HTTP 502\n",
  });
  expect(deleted(await runner.calls())).toEqual([]);
}, 30_000);

test("--prune warns of each artifact it could not delete, deletes the rest and exits 0", async () => {
  const runner = await selfHosted(PRUNE_RUNS, { failing: ["api -X DELETE repos/{owner}/{repo}/actions/artifacts/250"] });

  const pruned = await runner.run(["--prune"]);

  expect(pruned).toEqual({
    exitCode: 0,
    text:
      "::warning::mutation-baseline: could not delete mutation-baseline-full artifact 250: gh api -X DELETE repos/{owner}/{repo}/actions/artifacts/250: gh: HTTP 502\n" +
      "mutation-baseline: deleted artifacts 100, 300; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35; could not delete artifacts 250\n",
  });
  expect(deleted(await runner.calls())).toEqual([100, 300]);
}, 30_000);

test("--prune with nothing superseded deletes nothing", async () => {
  const runner = await selfHosted([
    run(35, "workflow_dispatch", "2026-10-04T00:00:00Z", [fullReport(350, "newest full")]),
    run(20, "push", "2026-10-02T00:00:00Z", [baseline(200, "mutation-baseline", "newest push")]),
  ]);

  const pruned = await runner.run(["--prune"]);

  expect(pruned).toEqual({
    exitCode: 0,
    text: "mutation-baseline: nothing to delete; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35\n",
  });
  expect(deleted(await runner.calls())).toEqual([]);
}, 30_000);

test("--prune with no baselines at all deletes nothing", async () => {
  const runner = await selfHosted([run(20, "push", "2026-10-02T00:00:00Z", [])]);

  const pruned = await runner.run(["--prune"]);

  expect(pruned).toEqual({ exitCode: 0, text: "mutation-baseline: nothing to delete; kept no baseline artifacts\n" });
  expect(deleted(await runner.calls())).toEqual([]);
}, 30_000);

const SAVED_SHELF = join(SHELVES, "saved", "mutation-baseline");

// Stryker writes the test runner's failure message into statusReason, and the saved entry keeps every other field.
const STATE = { files: { "src/a.ts": { mutants: [{ id: "1", status: "Killed", statusReason: "expected 1 to be 2", killedBy: ["0"] }] } }, testFiles: {} };
const SLIM_STATE = { files: { "src/a.ts": { mutants: [{ id: "1", status: "Killed", killedBy: ["0"] }] } }, testFiles: {} };

async function written(runner: Runner, file: string, content: unknown): Promise<void> {
  const target = join(runner.home, "work", file);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, JSON.stringify(content));
}

async function savedEntry(runner: Runner, runId: number, files: Readonly<Record<string, unknown>>): Promise<void> {
  await mkdir(join(runner.home, SAVED_SHELF), { recursive: true });
  await writeFile(join(runner.home, SAVED_SHELF, `${runId}.json`), JSON.stringify(files));
}

test("--save keeps the run's baseline on the runner's disk without statusReason, and the next restore copies it instead of downloading", async () => {
  const runner = await selfHosted(MAIN_RUNS);
  await written(runner, "reports/stryker-incremental.json", STATE);
  await written(runner, "reports/mutation/mutation.json", STATE);

  const saved = await runner.run(["--save", "reports/stryker-incremental.json", "reports/mutation/mutation.json"], { GITHUB_RUN_ID: "20" });
  const restored = await runner.run(["next/stryker-incremental.json", "next/mutation.json"]);

  expect(saved).toEqual({ exitCode: 0, text: "mutation-baseline: saved the mutation-baseline of run 20 on the runner's disk\n" });
  expect(restored).toEqual({ exitCode: 0, text: "mutation-baseline: restored it from the runner's disk, mutation-baseline saved by run 20\n" });
  expect(JSON.parse((await runner.read("next/stryker-incremental.json")) ?? "")).toEqual(SLIM_STATE);
  expect(JSON.parse((await runner.read("next/mutation.json")) ?? "")).toEqual(SLIM_STATE);
  expect(await runner.downloads()).toEqual([]);
}, 30_000);

test("--save run again in the same run replaces the entry an earlier attempt saved", async () => {
  const runner = await selfHosted(MAIN_RUNS);
  await written(runner, "reports/stryker-incremental.json", { attempt: 1 });
  await runner.run(["--save", "reports/stryker-incremental.json"], { GITHUB_RUN_ID: "20" });
  await written(runner, "reports/stryker-incremental.json", { attempt: 2 });

  const saved = await runner.run(["--save", "reports/stryker-incremental.json"], { GITHUB_RUN_ID: "20" });

  expect(saved).toEqual({ exitCode: 0, text: "mutation-baseline: saved the mutation-baseline of run 20 on the runner's disk\n" });
  expect(await runner.run(["next/stryker-incremental.json"])).toEqual({ exitCode: 0, text: "mutation-baseline: restored it from the runner's disk, mutation-baseline saved by run 20\n" });
  expect(await runner.read("next/stryker-incremental.json")).toBe('{"attempt":2}');
}, 30_000);

test("a restore from the disk removes the entries of older runs and keeps a newer run's", async () => {
  const runner = await selfHosted(MAIN_RUNS);
  for (const runId of [5, 10, 15, 20, 25]) await savedEntry(runner, runId, { "stryker-incremental.json": { run: runId } });

  const restored = await runner.run(["reports/stryker-incremental.json"]);

  expect(restored.text).toBe("mutation-baseline: restored it from the runner's disk, mutation-baseline saved by run 20\n");
  expect(await runner.read("reports/stryker-incremental.json")).toBe('{"run":20}');
  expect((await readdir(join(runner.home, SAVED_SHELF))).sort()).toEqual(["20.json", "25.json"]);
}, 30_000);

test("--save on a GitHub-hosted runner refuses, since its disk ends with the job, and writes nothing", async () => {
  const runner = await selfHosted(MAIN_RUNS);
  await written(runner, "reports/stryker-incremental.json", STATE);

  const saved = await runner.run(["--save", "reports/stryker-incremental.json"], { GITHUB_RUN_ID: "20", RUNNER_ENVIRONMENT: "github-hosted" });

  expect(saved).toEqual({
    exitCode: 2,
    text: "checks-mutation-baseline: a GitHub-hosted runner discards its disk when the job ends, so upload the baseline as an artifact there\n",
  });
  expect(await readdir(join(runner.home, ".cache")).catch(() => [])).toEqual([]);
}, 30_000);

test("--save outside a GitHub Actions job names the run id it lacks and exits 2", async () => {
  const runner = await selfHosted(MAIN_RUNS);
  await written(runner, "reports/stryker-incremental.json", STATE);

  expect(await runner.run(["--save", "reports/stryker-incremental.json"])).toEqual({
    exitCode: 2,
    text: "checks-mutation-baseline: GITHUB_RUN_ID is unset, so --save runs only inside a GitHub Actions job\n",
  });
}, 30_000);

test("--slim writes the report without statusReason for an upload and prints both sizes", async () => {
  const runner = await selfHosted(MAIN_RUNS);
  await written(runner, "reports/mutation/mutation.json", STATE);

  const slimmed = await runner.run(["--slim", "reports/mutation/mutation.json", "upload/mutation.json"]);

  const before = JSON.stringify(STATE).length;
  const after = JSON.stringify(SLIM_STATE).length;
  expect(slimmed).toEqual({ exitCode: 0, text: `mutation-baseline: wrote upload/mutation.json without statusReason, ${after} bytes from ${before}\n` });
  expect(JSON.parse((await runner.read("upload/mutation.json")) ?? "")).toEqual(SLIM_STATE);
}, 30_000);

test("--prune deletes the artifact of an older run once the newest successful run's baseline is on the disk", async () => {
  const runner = await selfHosted([run(40, "push", "2026-10-05T00:00:00Z", []), ...PRUNE_RUNS]);
  await savedEntry(runner, 40, { "stryker-incremental.json": { run: 40 } });

  const pruned = await runner.run(["--prune"]);

  expect(pruned).toEqual({
    exitCode: 0,
    text: "mutation-baseline: deleted artifacts 100, 200, 250, 300; kept mutation-baseline-full artifact 350 from run 35, the mutation-baseline run 40 saved on the runner's disk\n",
  });
  expect(deleted(await runner.calls())).toEqual([100, 200, 250, 300]);
}, 30_000);
