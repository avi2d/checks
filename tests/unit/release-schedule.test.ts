import { expect, test } from "bun:test";
import { Effect } from "effect";
import { pageWorkflow } from "../lib/doc-workflows.ts";
import { parseWorkflow } from "../../src/delivery/ci-wiring.ts";
import { findScheduledReleases, formatScheduleReport } from "../../src/delivery/release-schedule.ts";
import { isRecord } from "../../src/delivery/workflow-references.ts";

const PAGE = "docs/gates/checks-release-pr.md";

function triggers(text: string): readonly string[] {
  const document: unknown = Bun.YAML.parse(text);
  const on = isRecord(document) ? document["on"] : undefined;
  return isRecord(on) ? Object.keys(on) : [];
}

function named(files: Readonly<Record<string, string>>) {
  return Object.entries(files).map(([name, text]) => Effect.runSync(parseWorkflow(`.github/workflows/${name}`, text)));
}

function release(run: string): string {
  return `name: release\non:\n  workflow_dispatch:\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`;
}

async function templates() {
  const byHand = await pageWorkflow(PAGE, "release-pr");
  const daily = (await pageWorkflow(PAGE, "daily-release")) + byHand.slice(byHand.indexOf("permissions:"));
  return { byHand, daily };
}

function scheduled(run: string): string {
  return `name: daily-release\non:\n  schedule:\n    - cron: "7 3 * * *"\n  workflow_dispatch:\njobs:\n  pull-request:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`;
}

test("the release-pr template a repository that publishes nothing to npm copies holds no schedule that releases it daily", async () => {
  expect(triggers(await pageWorkflow(PAGE, "release-pr"))).toEqual(["workflow_dispatch", "push"]);
});

test("the daily-release triggers a package published to npm adds keep the schedule a by-hand release drops", async () => {
  expect(triggers(await pageWorkflow(PAGE, "daily-release"))).toEqual(["schedule", "workflow_dispatch", "push"]);
});

test("a repository that publishes nothing to npm is refused its scheduled release pull request rather than released daily", async () => {
  const { daily } = await templates();
  expect(findScheduledReleases(named({ "daily-release.yml": daily, "release.yml": release("echo publish") }))).toEqual([
    { location: ".github/workflows/daily-release.yml line 3" },
  ]);
});

test("a package published to npm keeps its scheduled release pull request rather than being refused for it", async () => {
  const { daily } = await templates();
  expect(findScheduledReleases(named({ "daily-release.yml": daily, "release.yml": release("npm publish") }))).toEqual([]);
  expect(findScheduledReleases(named({ "daily-release.yml": daily, "release.yml": release("./node_modules/.bin/checks-release-publish") }))).toEqual([]);
});

test("the by-hand release-pr template passes in a repository that publishes nothing to npm rather than being refused", async () => {
  const { byHand } = await templates();
  expect(findScheduledReleases(named({ "release-pr.yml": byHand, "release.yml": release("echo publish") }))).toEqual([]);
});

test("each way of calling checks-release-pr on a schedule is refused, not only the installed bin", () => {
  for (const run of ["bunx checks-release-pr ci.yml", "bun src/delivery/release-pr.ts ci.yml", "bun run checks-release-pr ci.yml", "./node_modules/.bin/checks-release-pr ci.yml"]) {
    expect(findScheduledReleases(named({ "daily-release.yml": scheduled(run) })).length).toBe(1);
  }
});

test("a schedule that only names checks-release-pr or runs something else is not refused as a release", () => {
  expect(findScheduledReleases(named({ "daily-release.yml": scheduled("echo checks-release-pr ci.yml") }))).toEqual([]);
  expect(findScheduledReleases(named({ "night-run.yml": scheduled("bun run test") }))).toEqual([]);
});

test("the report names each scheduled release and says to drop its schedule", () => {
  expect(formatScheduleReport([{ location: ".github/workflows/daily-release.yml line 3" }])).toBe(
    "ci-wiring: 1 workflow(s) schedule checks-release-pr, but no workflow publishes to npm:\n  .github/workflows/daily-release.yml line 3: drop the schedule, so the release pull request opens only when someone runs the workflow",
  );
});
