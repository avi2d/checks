import { expect, test } from "bun:test";
import { Effect } from "effect";
import { parseWorkflow } from "../../../src/delivery/ci-wiring.ts";
import { findScheduledRuns, weekly } from "../../../src/delivery/schedule-policy.ts";

const PUBLIC_PACKAGE = { visibility: "public", publishes: true } as const;
const NONE = { scripts: new Map<string, string>(), files: new Map<string, string>() };

function scheduled(cron: string, ...runs: readonly string[]): string {
  const steps = runs.map((run) => `      - run: ${run}\n`).join("");
  return `name: job\non:\n  schedule:\n    - cron: "${cron}"\n  workflow_dispatch:\njobs:\n  job:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n${steps}`;
}

function judged(text: string, owner: Parameters<typeof findScheduledRuns>[2] = PUBLIC_PACKAGE, context = NONE) {
  return findScheduledRuns([Effect.runSync(parseWorkflow(".github/workflows/job.yml", text))], context, owner);
}

const faultOf = (text: string, owner?: Parameters<typeof findScheduledRuns>[2]) => judged(text, owner).map(({ fault }) => fault);

test("a scheduled test, mutation, flake or browser run is refused rather than passed as a hand-run job", () => {
  for (const run of ["bun run test", "bunx stryker run", "bunx checks-flake", "bunx checks-lint --whole-tree", "bunx lighthouse https://example.com"]) {
    expect(judged(scheduled("7 2 * * *", "bun install --frozen-lockfile", run))).toEqual([
      { location: ".github/workflows/job.yml line 3", fault: "drop the schedule, so it runs only when someone starts it with gh workflow run" },
    ]);
  }
});

test("a weekly advisory scan in a public repository passes, through the bin or the kit's own source", () => {
  expect(judged(scheduled("15 5 * * 1", "bun install --frozen-lockfile", "./node_modules/.bin/checks-advisories --all"))).toEqual([]);
  expect(judged(scheduled("15 5 * * mon", "bun install --frozen-lockfile", "bun src/dependencies/advisories.ts --all"))).toEqual([]);
});

test("a daily advisory scan is refused instead of passing as the weekly one", () => {
  expect(faultOf(scheduled("15 5 * * *", "bunx checks-advisories --all"))).toEqual([
    'the advisory scan runs more than once a week; keep one cron at a minute, an hour and a weekday, such as "15 5 * * 1"',
  ]);
});

test("a weekly advisory scan in a private repository is refused rather than kept as the public scan", () => {
  const weeklyScan = scheduled("15 5 * * 1", "bunx checks-advisories --all");
  expect(faultOf(weeklyScan, { visibility: "private", publishes: true })).toEqual(["a private repository scans advisories by hand; drop the schedule, so it runs only when someone starts it with gh workflow run"]);
  expect(faultOf(weeklyScan, { visibility: "private", publishes: false })).toEqual(["a private repository scans advisories by hand; drop the schedule, so it runs only when someone starts it with gh workflow run"]);
});

test("a weekly advisory scan in a public repository that sets private is kept rather than refused as unpublished", () => {
  const weeklyScan = scheduled("15 5 * * 1", "bunx checks-advisories --all");
  expect(judged(weeklyScan, { visibility: "public", publishes: false })).toEqual([]);
});

test("a run outside CI does not refuse a weekly scan for a visibility it cannot read", () => {
  expect(judged(scheduled("15 5 * * 1", "bunx checks-advisories --all"), { visibility: "unknown", publishes: true })).toEqual([]);
  expect(judged(scheduled("15 5 * * 1", "bunx checks-advisories --all"), { visibility: "unknown", publishes: false })).toEqual([]);
});

test("an advisory workflow that also runs the suite is refused, so a test run cannot ride the advisory schedule", () => {
  expect(faultOf(scheduled("15 5 * * 1", "bunx checks-advisories --all", "bun run test"))).toEqual(["drop the schedule, so it runs only when someone starts it with gh workflow run"]);
});

test("a scheduled workflow that releases is left to the release refusal, not reported twice", () => {
  expect(judged(scheduled("7 3 * * *", "bunx checks-release-pr ci.yml"))).toEqual([]);
});

test("a workflow without a schedule passes whatever it runs", () => {
  expect(judged("name: job\non:\n  workflow_dispatch:\njobs:\n  job:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run test\n")).toEqual([]);
});

test("a cron is weekly only with one minute, one hour and one weekday on every day and month", () => {
  expect(["15 5 * * 1", "0 0 * * 0", "59 23 * * 7", "15 5 * * SUN"].filter(weekly)).toEqual(["15 5 * * 1", "0 0 * * 0", "59 23 * * 7", "15 5 * * SUN"]);
  expect(["15 5 * * *", "15 5 * * 1-5", "15 5 * * 1,4", "*/30 5 * * 1", "15 5 1 * 1", "15 5 * 1 1", "15 5 * * 1 2026"].filter(weekly)).toEqual([]);
});
