import { $ } from "bun";
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
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

function lostEnd(inspectorPasses: number, extra = ""): string {
  const message = [
    `bun's summary counts 4713 passing test(s), but the Bun inspector reported ${inspectorPasses}: test events were lost or merged on the way from bun to the runner`,
    "1 test(s) started but never reported a result: their TestReporter.end events were lost",
    extra,
    'the inspector WebSocket also closed unexpectedly (close code=1006 reason="" wasClean=false, 521ms after the last received frame), which is routine on its own and listed only as context',
  ].filter((reason) => reason !== "").join("; ");
  return `printf '%s\\n' "stryker-bun-runner: dry run data-completeness check failed — ${message.replaceAll('"', '\\"')}. Completing this dry run would hand Stryker incomplete data." >&2
exit 1`;
}

test("a lost end event with a complete Bun summary retries instead of failing a shard whose second dry run passes", async () => {
  const ran = await shard(`if [ ! -f attempted ]; then
  touch attempted
  ${lostEnd(4712)}
fi
mkdir -p reports
printf '%s\\n' '{"files":{"src/a.ts":{"mutants":[]}}}' > ${STATE}`);
  expect(ran.exitCode).toBe(0);
  expect(ran.stderr).toContain("Bun inspector reported 4712");
  expect(recordedCalls(scratch.at("calls"))).toHaveLength(2);
  expect(scratch.read(OUTPUT)).toBe(WRITTEN);
});

test.each([
  ["a larger disagreement", lostEnd(4711)],
  ["a coverage disagreement", lostEnd(4712, "coverage keys did not match")],
] as const)("a shard must not retry %s even if the inspector also closed with 1006", async (_name, diagnostic) => {
  const ran = await shard(diagnostic);
  expect(ran.exitCode).toBe(1);
  expect(recordedCalls(scratch.at("calls"))).toHaveLength(1);
  expect(existsSync(scratch.at(OUTPUT))).toBe(false);
});

test("a second lost end event fails the shard instead of accepting incomplete data or retrying again", async () => {
  const ran = await shard(lostEnd(4712));
  expect(ran.exitCode).toBe(1);
  expect(recordedCalls(scratch.at("calls"))).toHaveLength(2);
  expect(existsSync(scratch.at(OUTPUT))).toBe(false);
});

test("a first pass must upload new state without a restored input", async () => {
  const ran = await shard(`mkdir -p reports\nprintf '%s\\n' '{"files":{"src/a.ts":{"mutants":[]}}}' > ${STATE}\nexit 0`);
  expect(ran.exitCode).toBe(0);
  expect(scratch.read(OUTPUT)).toBe(WRITTEN);
});

test.each([0, 124])("a shard keeps only its own files instead of handing on the whole restored state after Stryker exits %i", async (exit) => {
  const state = {
    schemaVersion: "1.0",
    files: {
      "src/[a].ts": { source: "brackets", mutants: [] },
      "src/b*.ts": { source: "asterisk", mutants: [] },
      "src/a.ts": { source: "plain", mutants: [] },
    },
    testFiles: { "tests/unit/a.test.ts": { source: "shared", tests: [{ id: "0", name: "shared test" }] } },
    thresholds: { high: 80, low: 60 },
  };
  scratch.write("whole-state.json", JSON.stringify(state));
  stubBin(scratch.at("node_modules", ".bin"), "stryker", `cp whole-state.json ${STATE}\nexit ${exit}`);

  for (const [index, mutate, files] of [
    ["0", "src/[[]a[]].ts,src/b[*].ts", { "src/[a].ts": state.files["src/[a].ts"], "src/b*.ts": state.files["src/b*.ts"] }],
    ["1", "src/a.ts", { "src/a.ts": state.files["src/a.ts"] }],
  ] as const) {
    restoreState();
    const ran = await runCi("mutation", ["shard"], {
      PATH: process.env["PATH"] ?? "",
      STUB_RECORD: scratch.at("calls"),
      SHARD: mutate,
      INDEX: index,
    }, scratch.at());
    expect(ran.exitCode).toBe(0);
    expect(JSON.parse(scratch.read(`reports/shard/state-${index}.json`))).toEqual({ ...state, files });
    expect(existsSync(scratch.at(`reports/shard/stopped-${index}`))).toBe(exit === 124);
  }

  const merge = join(import.meta.dir, "../../../../src/testing/mutation-merge.ts");
  const merged = await $`${process.execPath} ${merge} merged.json reports/shard/state-0.json reports/shard/state-1.json`.cwd(scratch.at()).quiet().nothrow();
  expect(merged.exitCode).toBe(0);
  expect(JSON.parse(scratch.read("merged.json"))).toEqual(state);
});

test.each([{}, { files: null }, { files: [] }])("a shard refuses new state with no files object instead of uploading it: %j", async (state) => {
  restoreState();
  const ran = await shard(`printf '%s\\n' '${JSON.stringify(state)}' > ${STATE}\nexit 0`);
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain(`shard 2 state at ${STATE} has no files object`);
  expect(existsSync(scratch.at(OUTPUT))).toBe(false);
});
