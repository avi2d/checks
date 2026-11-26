import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { recordedCalls, runCi, stubBin, useScratch } from "../../lib/ci-command.ts";

const scratch = useScratch("whole-tree");
const MAIN = "whole-tree";
const LIVE_RUN = ["checks-test", "--tier=live", "--junit=reports/whole-tree-run-tests/live.xml"];
const PIXEL_RUN = ["checks-test", "--tier=pixel", "--junit=reports/whole-tree-run-tests/pixel.xml"];
const MUTATION = ["--mutation", "reports/mutation/mutation-baseline-full/mutation.json"];

function holdTests(files: readonly string[]): void {
  for (const file of files) {
    mkdirSync(dirname(scratch.at(file)), { recursive: true });
    writeFileSync(scratch.at(file), "");
  }
}

function step(part: string, bunx: string, env: Readonly<Record<string, string>> = {}) {
  stubBin(scratch.at("bin"), "bunx", bunx);
  return runCi(MAIN, [part], { PATH: `${scratch.at("bin")}:${process.env["PATH"] ?? ""}`, STUB_RECORD: scratch.at("calls"), ...env }, scratch.at());
}

test("a tests step that runs a tier without test files, skips a nested pixel file, or fails on a failing test, fails", async () => {
  holdTests(["tests/live/api.test.ts", "tests/pixel/screens/home.test.tsx", "tests/unit/sum.test.ts", "tests/e2e/cli.test.ts"]);
  const ran = await step("tests", "exit 1");
  expect(ran.exitCode).toBe(0);
  expect(recordedCalls(scratch.at("calls"))).toEqual([LIVE_RUN, PIXEL_RUN]);
  expect(scratch.read("reports/whole-tree-run-tests/manifest.txt")).toBe("ready\n");
});

test("a tests step with no long tier that runs checks-test or leaves no artifact to upload fails", async () => {
  holdTests(["tests/unit/sum.test.ts", "tests/quarantine/live-flaky.test.ts"]);
  const ran = await step("tests", "exit 0");
  expect(ran.exitCode).toBe(0);
  expect(recordedCalls(scratch.at("calls"))).toEqual([]);
  expect(scratch.read("reports/whole-tree-run-tests/manifest.txt")).toBe("ready\n");
});

test("a report that names a JUnit report the tests step never wrote, or passes the gates log of a failed gates job, fails", async () => {
  holdTests(["tests/live/api.test.ts", "tests/unit/sum.test.ts"]);
  expect((await step("tests", "exit 0")).exitCode).toBe(0);
  const ranTiers = recordedCalls(scratch.at("calls"));
  expect(ranTiers).toEqual([LIVE_RUN]);
  const failedGates = await step("report", "exit 0", { GATES_RESULT: "failure" });
  expect(failedGates.exitCode).toBe(0);
  const passedGates = await step("report", "exit 0", { GATES_RESULT: "success" });
  expect(passedGates.exitCode).toBe(0);
  expect(recordedCalls(scratch.at("calls")).slice(ranTiers.length)).toEqual([
    ["checks-whole-tree-run", ...MUTATION, "--tests", "reports/whole-tree-run-tests/live.xml"],
    ["checks-whole-tree-run", ...MUTATION, "--tests", "reports/whole-tree-run-tests/live.xml", "--gates", "reports/whole-tree-run-gates/gates.log"],
  ]);
});

test("a report that passes when checks-whole-tree-run fails, or runs without GATES_RESULT, fails", async () => {
  expect((await step("report", "exit 1", { GATES_RESULT: "success" })).exitCode).toBe(1);
  expect((await step("report", "exit 0")).exitCode).toBe(1);
});

test("a gates step that fails on a failed gate or drops the lint's stdout or stderr from the log fails", async () => {
  const ran = await step("gates", "echo 'checks-lint: 1 gate(s) failed: checks-docs'; echo 'checks-docs: 2 page(s) fail' >&2; exit 1");
  expect(ran.exitCode).toBe(0);
  expect(recordedCalls(scratch.at("calls"))).toEqual([["checks-lint", "--whole-tree"]]);
  expect(scratch.read("reports/whole-tree-run-gates/gates.log").split("\n").filter(Boolean).sort()).toEqual(["checks-docs: 2 page(s) fail", "checks-lint: 1 gate(s) failed: checks-docs"]);
});

test("a whole-tree step that takes a part it does not know fails", async () => {
  const ran = await step("sweep", "exit 0");
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("checks-ci whole-tree takes one of tests, gates, report, not sweep");
  expect(recordedCalls(scratch.at("calls"))).toEqual([]);
});
