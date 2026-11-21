import { expect, test } from "bun:test";
import { CI_MAIN } from "../../lib/ci-command.ts";

function gate(results: string, skips = "") {
  const result = Bun.spawnSync([process.execPath, CI_MAIN, "require-success"], { env: { RESULTS: results, SKIPS: skips } });
  return { exitCode: result.exitCode, stdout: result.stdout.toString() };
}

test("two successful jobs refused fails", () => {
  expect(gate("e2e=success pixel=success")).toEqual({ exitCode: 0, stdout: "e2e=success pixel=success\n" });
});

test.each(["e2e=success pixel=failure", "e2e=skipped pixel=success", "e2e=cancelled pixel=success", "e2e= pixel=success"])(
  "the results %p passed fails",
  (results) => {
    expect(gate(results).exitCode).toBe(1);
  },
);

test(
  "a newline-separated failure that passes fails",
  () => {
    expect(gate("e2e=success\npixel=failure\n").exitCode).toBe(1);
    expect(gate("e2e=success\npixel=success\n")).toEqual({ exitCode: 0, stdout: "e2e=success pixel=success\n" });
  },
  { timeout: 30_000 },
);

test("a failure message that does not name each job that did not succeed fails", () => {
  expect(gate("e2e=failure pixel=skipped runner=success").stdout).toBe("::error::e2e=failure pixel=skipped, where each result must be success, or skipped where skips names it true\n");
});

test("no results, which would require nothing, that passes fails", () => {
  expect(gate("  ")).toEqual({ exitCode: 1, stdout: "::error::require-success needs at least one name=result in results\n" });
});

test(
  "a skip the caller expects that fails the gate, or a skip it does not expect that passes, fails",
  () => {
    const parts = "changes=success unit=success static=success e2e=skipped";
    expect(gate(parts, "e2e=true")).toEqual({ exitCode: 0, stdout: `${parts}\n` });
    expect(gate(parts, "e2e=false").exitCode).toBe(1);
    expect(gate(parts, "e2e=").exitCode).toBe(1);
    expect(gate(parts, "unit=true").exitCode).toBe(1);
    expect(gate(parts, "xe2e=true").exitCode).toBe(1);
  },
  { timeout: 30_000 },
);

test(
  "an expected skip that excuses a failure fails",
  () => {
    expect(gate("unit=success e2e=failure", "e2e=true").exitCode).toBe(1);
    expect(gate("unit=success e2e=cancelled", "e2e=true").exitCode).toBe(1);
  },
  { timeout: 30_000 },
);

test(
  "a toJSON(needs) object read other than as one name=result pair per job fails",
  () => {
    const needs = JSON.stringify({ static: { result: "success", outputs: {} }, e2e: { result: "skipped", outputs: {} } });
    expect(gate(needs, "e2e")).toEqual({ exitCode: 0, stdout: "static=success e2e=skipped\n" });
    expect(gate(needs).stdout).toBe("::error::e2e=skipped, where each result must be success, or skipped where skips names it true\n");
    expect(gate(JSON.stringify({ unit: { result: "failure", outputs: {} } }), "unit").exitCode).toBe(1);
  },
  { timeout: 30_000 },
);

test(
  "an empty or unreadable toJSON(needs) object that passes fails",
  () => {
    expect(gate("{}").exitCode).toBe(1);
    expect(gate('{"unit": "success"}').exitCode).toBe(1);
    expect(gate("{ not json").exitCode).toBe(1);
  },
  { timeout: 30_000 },
);

test(
  "a bare job name in skips that excuses no skip, or excuses another job's skip, fails",
  () => {
    const parts = "static=success e2e=skipped pixel=skipped";
    expect(gate(parts, "e2e pixel").exitCode).toBe(0);
    expect(gate(parts, "e2e").exitCode).toBe(1);
    expect(gate(parts, "e2 pixel").exitCode).toBe(1);
    expect(gate(parts, "e2e=true pixel").exitCode).toBe(0);
    expect(gate(parts, "e2e=false pixel").exitCode).toBe(1);
  },
  { timeout: 30_000 },
);

test("a bare result without its job name that passes fails", () => {
  expect(gate("success")).toEqual({ exitCode: 1, stdout: "::error::require-success takes name=result pairs, not 'success'\n" });
});
