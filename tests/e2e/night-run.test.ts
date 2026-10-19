import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeActions, type FakeActions, type FakeRun } from "./lib/fake-actions.ts";
import { CHECKOUT, ran, type Ran, scratchDirs } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "testing", "night-run.ts");
const FIXTURES = join(CHECKOUT, "tests", "fixtures", "night-run");
const RUNS = "https://github.com/acme/widget/actions/runs";
const ACTIONS_ENV = {
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "acme/widget",
  GITHUB_RUN_ID: "12",
  GITHUB_WORKFLOW_REF: "acme/widget/.github/workflows/night-run.yml@refs/heads/main",
  GITHUB_REF: "refs/heads/main",
};

const scratch = scratchDirs();

type Night = FakeActions & {
  readonly work: string;
  readonly run: (tests: readonly string[]) => Promise<Ran>;
  readonly runWith: (args: readonly string[], env: Readonly<Record<string, string>>) => Promise<Ran>;
};

function lastNight(scores: Readonly<Record<string, { readonly detected: number; readonly valid: number }>>): FakeRun {
  return { databaseId: 11, event: "schedule", createdAt: "2026-10-18T22:07:00Z", artifacts: [{ id: 110, name: "night-run", expired: false, files: { "night-run.json": JSON.stringify({ scores }) } }] };
}

async function night(runs: readonly FakeRun[]): Promise<Night> {
  const home = await scratch("checks-night-run-");
  const fake = await fakeActions(home, 4242, runs, { workflow: "night-run.yml" });
  const work = join(home, "work");
  await mkdir(work);
  const runWith = (args: readonly string[], env: Readonly<Record<string, string>>) => ran($`bun ${SCRIPT} ${args}`.cwd(work).env({ ...process.env, ...ACTIONS_ENV, ...env, ...fake.env }));
  const run = (tests: readonly string[]) => runWith(["--mutation", join(FIXTURES, "mutation.json"), ...testArgs(tests)], {});
  return { ...fake, work, run, runWith };
}

const testArgs = (tests: readonly string[]): readonly string[] => tests.flatMap((file) => ["--tests", join(FIXTURES, file)]);

const recorded = (work: string): Promise<boolean> => Bun.file(join(work, "reports", "night-run.json")).exists();

const record = async (work: string): Promise<unknown> => JSON.parse(await readFile(join(work, "reports", "night-run.json"), "utf8"));

test("a regression that persists two nights opens one issue per finding the first night and comments on each the second", async () => {
  const runner = await night([lastNight({ "src/mixed.ts": { detected: 3, valid: 4 }, "src/killed.ts": { detected: 2, valid: 2 } })]);

  const first = await runner.run(["failing.xml"]);
  const second = await runner.run(["failing.xml"]);

  expect(first).toEqual({
    exitCode: 0,
    text: [
      `checks-night-run: the night run ${RUNS}/12 compared with the night run ${RUNS}/11; 3 finding(s)`,
      "  opened #100 for mutation:src/mixed.ts",
      "  opened #101 for test:tests/unit/cart.test.ts > totals > rounds half to even",
      "  opened #102 for test:tests/unit/session.test.ts",
      "checks-night-run: recorded 3 file score(s) in reports/night-run.json",
      "",
    ].join("\n"),
  });
  expect(second.exitCode).toBe(0);
  expect(second.text).toContain("  commented on #100 for mutation:src/mixed.ts\n");
  expect(await runner.labels()).toEqual(["night-run"]);
  const issues = await runner.issues();
  expect(issues.map(({ number, title, labels, comments }) => ({ number, title, labels, comments: comments.length }))).toEqual([
    { number: 100, title: "Night run: mutation score fell in src/mixed.ts", labels: ["night-run"], comments: 1 },
    { number: 101, title: "Night run: tests/unit/cart.test.ts > totals > rounds half to even fails", labels: ["night-run"], comments: 1 },
    { number: 102, title: "Night run: tests/unit/session.test.ts crashed its test worker", labels: ["night-run"], comments: 1 },
  ]);
  expect(issues[0]?.body).toContain("| `src/mixed.ts` | 75.00%, 3 of 4 mutants detected | 50.00%, 2 of 4 mutants detected |");
  expect(issues[0]?.body).toContain(`${RUNS}/12`);
  expect(await record(runner.work)).toEqual({
    scores: { "src/ignored.ts": { detected: 0, valid: 0 }, "src/killed.ts": { detected: 2, valid: 2 }, "src/mixed.ts": { detected: 2, valid: 4 } },
  });
}, 30_000);

test("a quiet night touches neither the label nor any issue and still records tonight's scores", async () => {
  const runner = await night([lastNight({ "src/mixed.ts": { detected: 2, valid: 4 } })]);

  const quiet = await runner.run(["passing.xml"]);

  expect(quiet.exitCode).toBe(0);
  expect(quiet.text).toContain("; no finding\n");
  expect((await runner.calls()).filter((call) => call.startsWith("label") || call.includes("/issues"))).toEqual([]);
  expect(await runner.issues()).toEqual([]);
  expect(await record(runner.work)).toMatchObject({ scores: { "src/mixed.ts": { detected: 2, valid: 4 } } });
}, 30_000);

test("with no previous night it files each failing test and no score", async () => {
  const runner = await night([]);

  const first = await runner.run(["failing.xml"]);

  expect(first.exitCode).toBe(0);
  expect(first.text).toContain("found no earlier successful run on main holding a night-run artifact, so it compared no score; 2 finding(s)");
  expect((await runner.issues()).map((issue) => issue.title)).toEqual([
    "Night run: tests/unit/cart.test.ts > totals > rounds half to even fails",
    "Night run: tests/unit/session.test.ts crashed its test worker",
  ]);
}, 30_000);

test("with no mutation report it files each failing test, compares no score and records none", async () => {
  const runner = await night([lastNight({ "src/mixed.ts": { detected: 3, valid: 4 } })]);

  const unscored = await runner.runWith(testArgs(["failing.xml"]), {});

  expect(unscored).toEqual({
    exitCode: 0,
    text: [
      `checks-night-run: the night run ${RUNS}/12 had no mutation report, so it compared no score; 2 finding(s)`,
      "  opened #100 for test:tests/unit/cart.test.ts > totals > rounds half to even",
      "  opened #101 for test:tests/unit/session.test.ts",
      "checks-night-run: recorded no score, since it had no mutation report",
      "",
    ].join("\n"),
  });
  expect((await runner.calls()).filter((call) => call.startsWith("run "))).toEqual([]);
  expect(await recorded(runner.work)).toBe(false);
}, 30_000);

test("a run on a branch lists each finding in its log, files no issue and records no score", async () => {
  const runner = await night([lastNight({ "src/mixed.ts": { detected: 3, valid: 4 } })]);
  const branch = { GITHUB_REF: "refs/heads/feature", GITHUB_WORKFLOW_REF: "acme/widget/.github/workflows/night-run.yml@refs/heads/feature" };

  const dispatched = await runner.runWith(["--mutation", join(FIXTURES, "mutation.json"), ...testArgs(["failing.xml"])], branch);

  expect(dispatched).toEqual({
    exitCode: 0,
    text: [
      `checks-night-run: the night run ${RUNS}/12 compared with the night run ${RUNS}/11; 3 finding(s)`,
      "  found mutation:src/mixed.ts",
      "  found test:tests/unit/cart.test.ts > totals > rounds half to even",
      "  found test:tests/unit/session.test.ts",
      "checks-night-run: the run is on refs/heads/feature, not main, so it filed no issue and recorded no score",
      "",
    ].join("\n"),
  });
  expect((await runner.calls()).filter((call) => call.startsWith("label") || call.includes("/issues"))).toEqual([]);
  expect(await runner.issues()).toEqual([]);
  expect(await recorded(runner.work)).toBe(false);
}, 30_000);

test("outside a GitHub Actions job it names the variable it lacks", async () => {
  const runner = await night([]);
  const { GITHUB_RUN_ID: _run, ...env } = { ...process.env, ...ACTIONS_ENV };

  const refused = await ran($`bun ${SCRIPT} --mutation ${join(FIXTURES, "mutation.json")}`.cwd(runner.work).env(env));

  expect(refused).toEqual({ exitCode: 2, text: "checks-night-run: GITHUB_RUN_ID is unset, so checks-night-run runs only inside a GitHub Actions job\n" });
}, 30_000);
