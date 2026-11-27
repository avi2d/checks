import { expect, test } from "bun:test";
import { existsSync, mkdirSync, utimesSync } from "node:fs";
import { recordedCalls, runCi, stubBin, useScratch } from "../../lib/ci-command.ts";

const scratch = useScratch("mutation-shard");
const STATE = "reports/stryker-incremental.json";
const OUTPUT = "reports/shard/state-2.json";
const STOPPED = "reports/shard/stopped-2";
const RESTORED = '{"files":{"src/b.ts":{"mutants":[]}}}\n';
const WRITTEN = '{"files":{"src/a.ts":{"mutants":[]}}}\n';

function restoreState(): void {
  mkdirSync(scratch.at("reports"), { recursive: true });
  scratch.write(STATE, RESTORED);
  utimesSync(scratch.at(STATE), 0, 0);
}

function shard(body: string) {
  stubBin(scratch.at("bin"), "timeout", body);
  return runCi("mutation", ["shard"], {
    PATH: `${scratch.at("bin")}:${process.env["PATH"] ?? ""}`,
    STUB_RECORD: scratch.at("calls"),
    SHARD: "src/a.ts",
    INDEX: "2",
  }, scratch.at());
}

test.each([0, 124])("a shard cannot upload restored state when Stryker exits %i without writing", async (exit) => {
  restoreState();
  const ran = await shard(`exit ${exit}`);
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain(`stryker wrote no new ${STATE}, so shard 2 has no state to hand on`);
  expect(existsSync(scratch.at(OUTPUT))).toBe(false);
  expect(existsSync(scratch.at(STOPPED))).toBe(false);
  expect(scratch.read(STATE)).toBe(RESTORED);
});

test.each([0, 124])("a shard cannot succeed without any state when Stryker exits %i", async (exit) => {
  const ran = await shard(`exit ${exit}`);
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("shard 2 has no state to hand on");
  expect(existsSync(scratch.at(OUTPUT))).toBe(false);
});

test.each([0, 124])("a shard must upload newly written same-size state after Stryker exits %i", async (exit) => {
  restoreState();
  const ran = await shard(`printf '%s\\n' '{"files":{"src/a.ts":{"mutants":[]}}}' > ${STATE}\nexit ${exit}`);
  expect(ran.exitCode).toBe(0);
  expect(scratch.read(OUTPUT)).toBe(WRITTEN);
  expect(existsSync(scratch.at(STOPPED))).toBe(exit === 124);
  expect(recordedCalls(scratch.at("calls"))).toEqual([
    ["-s", "TERM", "30m", "node_modules/.bin/stryker", "run", "--incremental", "--mutate", "src/a.ts"],
  ]);
});

test("a first pass must upload new state without a restored input", async () => {
  const ran = await shard(`mkdir -p reports\nprintf '%s\\n' '{"files":{"src/a.ts":{"mutants":[]}}}' > ${STATE}\nexit 0`);
  expect(ran.exitCode).toBe(0);
  expect(scratch.read(OUTPUT)).toBe(WRITTEN);
});
