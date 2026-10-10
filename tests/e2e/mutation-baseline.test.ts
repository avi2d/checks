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
  readonly run: (args: readonly string[], env?: Readonly<Record<string, string>>) => Promise<Ran>;
  readonly downloads: () => Promise<readonly string[]>;
  readonly read: (file: string) => Promise<string | undefined>;
  readonly shelf: (artifact: string) => Promise<readonly string[]>;
};

function baseline(id: number, name: string, tag: string, expired = false) {
  return { id, name, expired, files: { "stryker-incremental.json": `{"state":"${tag}"}`, "mutation/mutation.json": `{"report":"${tag}"}` } };
}

// The full artifact as upload-artifact writes it from the one path reports/mutation/mutation.json: the file at its root.
function fullReport(id: number, tag: string) {
  return { id, name: "mutation-baseline-full", expired: false, files: { "mutation.json": `{"report":"${tag}"}` } };
}

function run(databaseId: number, event: string, createdAt: string, artifacts: FakeRun["artifacts"]): FakeRun {
  return { databaseId, event, createdAt, artifacts };
}

// HOME holds the runner's cache, so each runner starts with an empty one.
async function selfHosted(runs: readonly FakeRun[], options: FakeOptions = {}): Promise<Runner> {
  const home = await scratch("checks-mutation-baseline-");
  const fake = await fakeActions(home, REPOSITORY_ID, runs, options);
  const work = join(home, "work");
  await mkdir(work);
  return {
    home,
    run: (args, env = {}) => ran($`bun ${SCRIPT} ${args}`.cwd(work).env({ ...process.env, RUNNER_ENVIRONMENT: "self-hosted", ...fake.env, HOME: home, ...env })),
    downloads: fake.downloads,
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

test("a missing destination prints the usage and exits 2", async () => {
  const runner = await selfHosted(MAIN_RUNS);
  expect(await runner.run(["--full"])).toEqual({
    exitCode: 2,
    text: "checks-mutation-baseline: usage: checks-mutation-baseline <incremental-dest> [mutation-json-dest] | --full <mutation-json-dest>\n",
  });
}, 30_000);
