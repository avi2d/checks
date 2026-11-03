import { expect, test } from "bun:test";
import { Effect } from "effect";
import { docWorkflows, pageWorkflow } from "../lib/doc-workflows.ts";
import { parseWorkflow } from "../../src/delivery/ci-wiring.ts";
import { atMostDaily, findScheduledReleases, formatScheduleReport, type ScheduleOwner } from "../../src/delivery/release-schedule.ts";
import { isRecord } from "../../src/delivery/workflow-references.ts";

const PAGE = "docs/gates/checks-release-pr.md";
const PUBLIC_PACKAGE: ScheduleOwner = { visibility: "public", publishes: true };
const PRIVATE_REPOSITORY: ScheduleOwner = { visibility: "private", publishes: true };
const NONE = { scripts: new Map<string, string>(), files: new Map<string, string>() };
const NOT_NPM = "only a public package that publishes to npm releases on a schedule; drop the schedule, so a release runs only when someone starts it";
const RELEASE_STEP = /checks-release-(pr|push|tag|publish)\b|release-(pr|push|tag|publish)\.ts|npm publish/;

function triggers(document: unknown): readonly string[] {
  const on = isRecord(document) ? document["on"] : undefined;
  return isRecord(on) ? Object.keys(on) : [];
}

function named(files: Readonly<Record<string, string>>) {
  return Object.entries(files).map(([name, text]) => Effect.runSync(parseWorkflow(`.github/workflows/${name}`, text)));
}

function release(run: string): string {
  return `name: release\non:\n  workflow_dispatch:\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`;
}

function scheduled(run: string): string {
  return `name: nightly\non:\n  schedule:\n    - cron: "7 3 * * *"\n  workflow_dispatch:\njobs:\n  job:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`;
}

function withSchedule(workflow: string, cron = "7 3 * * *"): string {
  return workflow.replace("on:\n", `on:\n  schedule:\n    - cron: "${cron}"\n`);
}

function judged(files: Readonly<Record<string, string>>, owner: ScheduleOwner = PUBLIC_PACKAGE, context = NONE) {
  return findScheduledReleases(named(files), context, owner);
}

test("no release workflow a docs page offers to copy holds a schedule, so none releases daily", async () => {
  const releasing = (await docWorkflows()).filter((workflow) => workflow.page.startsWith("docs/gates/checks-release-") || RELEASE_STEP.test(workflow.text));
  expect(releasing.map(({ page, name }) => `${page} ${name}`)).toContain(`${PAGE} release-pr`);
  expect(releasing.filter((workflow) => triggers(workflow.document).includes("schedule")).map(({ page, name }) => `${page} ${name}`)).toEqual([]);
});

test("the release-pr template runs by hand and on push for its tag job, with no daily-release twin on the page", async () => {
  expect(triggers(Bun.YAML.parse(await pageWorkflow(PAGE, "release-pr")))).toEqual(["workflow_dispatch", "push"]);
  const onPage = (await docWorkflows()).filter((workflow) => workflow.page === PAGE).map(({ name }) => name);
  expect(onPage).toContain("release-pr");
  expect(onPage).not.toContain("daily-release");
});

test("a daily release in a repository that publishes nothing to npm is refused", async () => {
  const daily = withSchedule(await pageWorkflow(PAGE, "release-pr"));
  expect(judged({ "daily-release.yml": daily, "release.yml": release("echo publish") })).toEqual([{ location: ".github/workflows/daily-release.yml line 3", fault: NOT_NPM }]);
});

test("a daily release in a public package that publishes to npm passes, through npm publish or the kit's publish bin", async () => {
  const daily = withSchedule(await pageWorkflow(PAGE, "release-pr"));
  for (const publish of ["npm publish", "./node_modules/.bin/checks-release-publish", "bun src/delivery/release-publish.ts"]) {
    expect(judged({ "daily-release.yml": daily, "release.yml": release(publish) })).toEqual([]);
  }
});

test("a daily npm release is refused in a private repository or a package.json that sets private, instead of passing for its publish step", async () => {
  const files = { "daily-release.yml": withSchedule(await pageWorkflow(PAGE, "release-pr")), "release.yml": release("npm publish") };
  expect(judged(files, PRIVATE_REPOSITORY)).toEqual([{ location: ".github/workflows/daily-release.yml line 3", fault: NOT_NPM }]);
  expect(judged(files, { visibility: "public", publishes: false })).toEqual([{ location: ".github/workflows/daily-release.yml line 3", fault: NOT_NPM }]);
});

test("a run outside CI does not refuse a daily npm release for a visibility it cannot read", async () => {
  const files = { "daily-release.yml": withSchedule(await pageWorkflow(PAGE, "release-pr")), "release.yml": release("npm publish") };
  expect(judged(files, { visibility: "unknown", publishes: true })).toEqual([]);
});

test("an npm release that runs more than once a day is refused rather than passing as the daily one", async () => {
  const hourly = withSchedule(await pageWorkflow(PAGE, "release-pr"), "7 * * * *");
  expect(judged({ "daily-release.yml": hourly, "release.yml": release("npm publish") })).toEqual([
    { location: ".github/workflows/daily-release.yml line 3", fault: 'the release runs more than once a day; keep one cron at a minute and an hour, such as "7 3 * * *"' },
  ]);
});

test("a cron fires at most once a day only with one minute and one hour", () => {
  expect(["7 3 * * *", "0 0 * * 1", "7 3 1 * *", "7 3 * * 1-5"].filter(atMostDaily)).toEqual(["7 3 * * *", "0 0 * * 1", "7 3 1 * *", "7 3 * * 1-5"]);
  expect(["7 * * * *", "*/30 3 * * *", "7 3,15 * * *", "7 1-3 * * *", "7 3 * *", "7 3 * * * 2026"].filter(atMostDaily)).toEqual([]);
});

test("the release-pr template as written passes, so a by-hand release is not refused", async () => {
  expect(judged({ "release-pr.yml": await pageWorkflow(PAGE, "release-pr"), "release.yml": release("npm publish") }, PRIVATE_REPOSITORY)).toEqual([]);
});

test("each release bin and each way of calling one on a schedule is refused, not only checks-release-pr", () => {
  const runs = [
    "bunx checks-release-pr ci.yml",
    "bun src/delivery/release-pr.ts ci.yml",
    "bun run checks-release-pr ci.yml",
    "./node_modules/.bin/checks-release-pr ci.yml",
    "bunx checks-release-push ci.yml",
    "bunx checks-release-tag release.yml",
    "bunx checks-release-publish",
    "npm publish --provenance",
  ];
  for (const run of runs) expect(judged({ "nightly.yml": scheduled(run) }, PRIVATE_REPOSITORY)).toEqual([{ location: ".github/workflows/nightly.yml line 3", fault: NOT_NPM }]);
});

test("a schedule that only names a release bin or runs something else is not refused as a release", () => {
  expect(judged({ "nightly.yml": scheduled("echo checks-release-pr ci.yml") }, PRIVATE_REPOSITORY)).toEqual([]);
  expect(judged({ "night-run.yml": scheduled("bun run test") }, PRIVATE_REPOSITORY)).toEqual([]);
});

test("a schedule that reaches checks-release-pr through a bun run package script releases on a schedule", () => {
  const context = { scripts: new Map([["release", "bunx checks-release-pr ci.yml"]]), files: new Map<string, string>() };
  expect(judged({ "nightly.yml": scheduled("bun run release") }, PUBLIC_PACKAGE, context)).toEqual([{ location: ".github/workflows/nightly.yml line 3", fault: NOT_NPM }]);
});

test("a schedule that reaches checks-release-pr through a local reusable workflow releases on a schedule", () => {
  const caller = `name: nightly\non:\n  schedule:\n    - cron: "7 3 * * *"\njobs:\n  cut:\n    uses: ./.github/workflows/cut.yml\n`;
  const callee = release("bunx checks-release-pr ci.yml");
  expect(judged({ "nightly.yml": caller, "cut.yml": callee })).toEqual([{ location: ".github/workflows/nightly.yml line 3", fault: NOT_NPM }]);
});

test("the report names each scheduled release and what to change", () => {
  expect(formatScheduleReport([{ location: ".github/workflows/daily-release.yml line 3", fault: NOT_NPM }])).toBe(
    "ci-wiring: 1 workflow(s) release on a schedule:\n  .github/workflows/daily-release.yml line 3: " + NOT_NPM,
  );
});
