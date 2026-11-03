import { expect, test } from "bun:test";
import { Effect } from "effect";
import { parseWorkflow } from "../../src/delivery/ci-wiring.ts";
import { findLongJobs } from "../../src/delivery/job-timeout.ts";

const job = (lines: string): string => `name: ci\non: pull_request\njobs:\n  checks:\n${lines}`;
const steps = "    steps:\n      - run: bun run test\n";
const judged = (text: string) => findLongJobs([Effect.runSync(parseWorkflow(".github/workflows/ci.yml", text))]);
const faultsOf = (text: string) => judged(text).map(({ fault }) => fault);

test("a job with no timeout is refused rather than left to GitHub's 360 minute default", () => {
  expect(faultsOf(job("    runs-on: ubuntu-latest\n" + steps))).toEqual([
    "the job sets no timeout-minutes, so a hung run holds its runner for GitHub's 360 minute default; set timeout-minutes to a number of at most 60",
  ]);
});

test("a timeout of exactly an hour passes and one a minute over is refused", () => {
  expect(faultsOf(job("    runs-on: ubuntu-latest\n    timeout-minutes: 60\n" + steps))).toEqual([]);
  expect(faultsOf(job("    runs-on: ubuntu-latest\n    timeout-minutes: 61\n" + steps))).toEqual([
    "its timeout-minutes of 61 lets the job run for hours; set timeout-minutes to a number of at most 60",
  ]);
});

test("a timeout read from an expression is refused instead of trusted to stay within an hour", () => {
  expect(faultsOf(job("    runs-on: ubuntu-latest\n    timeout-minutes: ${{ vars.TIMEOUT }}\n" + steps))).toEqual([
    "its timeout-minutes cannot be shown to stay within an hour before the run; set timeout-minutes to a number of at most 60",
  ]);
});

test("a job that calls a reusable workflow passes without a timeout instead of being refused for a key GitHub rejects there", () => {
  expect(faultsOf(job("    uses: ./.github/workflows/release.yml\n"))).toEqual([]);
});

test("each refused job is named by its workflow and id, not only the first", () => {
  const text = job("    runs-on: ubuntu-latest\n" + steps) + "  e2e:\n    runs-on: ubuntu-latest\n    timeout-minutes: 120\n" + steps;
  expect(judged(text).map(({ location }) => location)).toEqual([".github/workflows/ci.yml job checks", ".github/workflows/ci.yml job e2e"]);
});
