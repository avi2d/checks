import { expect, test } from "bun:test";
import { Effect } from "effect";
import { docWorkflows, pageWorkflow } from "../lib/doc-workflows.ts";
import { parseWorkflow } from "../../src/delivery/ci-wiring.ts";
import { findScheduledReleases, formatScheduleReport } from "../../src/delivery/release-schedule.ts";
import { isRecord } from "../../src/delivery/workflow-references.ts";

const PAGE = "docs/gates/checks-release-pr.md";
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

function withSchedule(workflow: string): string {
  return workflow.replace("on:\n", 'on:\n  schedule:\n    - cron: "7 3 * * *"\n');
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

test("a consumer that schedules the release-pr template is refused whether or not it publishes to npm", async () => {
  const daily = withSchedule(await pageWorkflow(PAGE, "release-pr"));
  for (const publish of ["echo publish", "npm publish", "./node_modules/.bin/checks-release-publish"]) {
    expect(findScheduledReleases(named({ "daily-release.yml": daily, "release.yml": release(publish) }))).toEqual([{ location: ".github/workflows/daily-release.yml line 3" }]);
  }
});

test("the release-pr template as written passes, so a by-hand release is not refused", async () => {
  expect(findScheduledReleases(named({ "release-pr.yml": await pageWorkflow(PAGE, "release-pr"), "release.yml": release("npm publish") }))).toEqual([]);
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
  for (const run of runs) expect(findScheduledReleases(named({ "nightly.yml": scheduled(run) }))).toEqual([{ location: ".github/workflows/nightly.yml line 3" }]);
});

test("a schedule that only names a release bin or runs something else is not refused as a release", () => {
  expect(findScheduledReleases(named({ "nightly.yml": scheduled("echo checks-release-pr ci.yml") }))).toEqual([]);
  expect(findScheduledReleases(named({ "night-run.yml": scheduled("bun run test") }))).toEqual([]);
});

test("a schedule that reaches checks-release-pr through a bun run package script releases on a schedule", () => {
  const context = { scripts: new Map([["release", "bunx checks-release-pr ci.yml"]]), files: new Map<string, string>() };
  expect(findScheduledReleases(named({ "nightly.yml": scheduled("bun run release") }), context)).toEqual([{ location: ".github/workflows/nightly.yml line 3" }]);
});

test("a schedule that reaches checks-release-pr through an npm run package script releases on a schedule", () => {
  const context = { scripts: new Map([["release", "bunx checks-release-pr ci.yml"]]), files: new Map<string, string>() };
  expect(findScheduledReleases(named({ "nightly.yml": scheduled("npm run release") }), context)).toEqual([{ location: ".github/workflows/nightly.yml line 3" }]);
});

test("a schedule that reaches checks-release-pr through a local reusable workflow releases on a schedule", () => {
  const caller = `name: nightly\non:\n  schedule:\n    - cron: "7 3 * * *"\njobs:\n  cut:\n    uses: ./.github/workflows/cut.yml\n`;
  const callee = release("bunx checks-release-pr ci.yml");
  expect(findScheduledReleases(named({ "nightly.yml": caller, "cut.yml": callee }), { scripts: new Map(), files: new Map() })).toEqual([
    { location: ".github/workflows/nightly.yml line 3" },
  ]);
});

test("a schedule that reaches checks-release-pr through a repository shell script releases on a schedule", () => {
  const context = { scripts: new Map<string, string>(), files: new Map([["scripts/release.sh", "bunx checks-release-pr ci.yml"]]) };
  expect(findScheduledReleases(named({ "nightly.yml": scheduled("./scripts/release.sh") }), context)).toEqual([{ location: ".github/workflows/nightly.yml line 3" }]);
});

test("the report names each scheduled release and says to drop its schedule", () => {
  expect(formatScheduleReport([{ location: ".github/workflows/daily-release.yml line 3" }])).toBe(
    "ci-wiring: 1 workflow(s) release on a schedule:\n  .github/workflows/daily-release.yml line 3: drop the schedule, so a release runs only when someone starts it",
  );
});
