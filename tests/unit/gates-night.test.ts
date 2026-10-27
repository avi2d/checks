import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import { parseWorkflow } from "../../src/delivery/ci-wiring.ts";
import { isRecord, workflowJobs } from "../../src/delivery/workflow-references.ts";
import { fromProgram, invokes, shellCommands } from "../../src/delivery/shell-command.ts";
import { selectSuite, suiteArgs, testOptions } from "../../src/testing/test.ts";
import { KIT_GATES, NIGHT_GATES, PR_GATES } from "../../src/core/gates.ts";

const RETIRED = [
  "checks-lint-coverage",
  "checks-quarantine-clock",
  "checks-suppressions-ratchet",
  "checks-repetition",
] as const;

const WATCH_LIST = ["checks-secrets", "checks-unused", "checks-exports", "checks-imports"] as const;

const MOVED = ["browser.test.ts", "stryker-consumer.test.ts", "stryker-consumer-config.test.ts", "stryker-consumer-runtime-read.test.ts"] as const;

const binsOf = (gates: readonly { readonly bin: string }[]): readonly string[] => gates.map(({ bin }) => bin).toSorted();

test("retiring gates to the night run never skips secrets, unused, exports or imports on a per-PR run", () => {
  expect(binsOf(NIGHT_GATES)).toEqual([...RETIRED].toSorted());
  expect(binsOf(PR_GATES)).toEqual(binsOf(KIT_GATES).filter((bin) => !(RETIRED as readonly string[]).includes(bin)));
  for (const bin of WATCH_LIST) expect(PR_GATES.some((gate) => gate.bin === bin)).toBe(true);
  for (const bin of RETIRED) expect(PR_GATES.some((gate) => gate.bin === bin)).toBe(false);
});

function disabled(node: unknown): boolean {
  if (!isRecord(node)) return false;
  return node["if"] === false || node["continue-on-error"] === true;
}

function scheduledCommands(path: string, jobId: string): readonly (readonly string[])[] {
  const text = readFileSync(resolve(import.meta.dir, "..", "..", path), "utf8");
  const workflow = Effect.runSync(parseWorkflow(path, text));
  const jobs = new Map(workflowJobs(workflow));
  const job = jobs.get(jobId);
  if (!isRecord(job) || disabled(job) || !Array.isArray(job["steps"])) return [];
  return job["steps"].flatMap((step: unknown) => {
    if (!isRecord(step) || typeof step["run"] !== "string" || disabled(step)) return [];
    return shellCommands(step["run"]).map((words) => fromProgram(words));
  });
}

function scheduledJobIds(path: string): readonly string[] {
  const text = readFileSync(resolve(import.meta.dir, "..", "..", path), "utf8");
  const workflow = Effect.runSync(parseWorkflow(path, text));
  return [...new Map(workflowJobs(workflow)).keys()].toSorted();
}

function scheduledCrons(path: string): readonly string[] {
  const text = readFileSync(resolve(import.meta.dir, "..", "..", path), "utf8");
  const workflow = Effect.runSync(parseWorkflow(path, text));
  const on = isRecord(workflow.document) ? workflow.document["on"] : undefined;
  if (!isRecord(on) || !Array.isArray(on["schedule"])) return [];
  return on["schedule"].flatMap((entry: unknown) => (isRecord(entry) && typeof entry["cron"] === "string" ? [entry["cron"]] : []));
}

test("rejects a night workflow that mentions the night gates without an executable scheduled step", () => {
  const path = ".github/workflows/night-run.yml";
  expect(scheduledJobIds(path)).toEqual(["gates", "mutation", "report", "tests"]);
  expect(scheduledCrons(path).length).toBeGreaterThan(0);
  const gates = scheduledCommands(path, "gates");
  expect(gates.some((command) => command.join(" ") === "bun src/core/lint.ts --night")).toBe(true);
  expect(gates.some((command) => invokes(command, ["bun", "src/core/lint.ts", "--night"]))).toBe(true);
});

test("rejects a night workflow whose tests job never executes the live tier", () => {
  const path = ".github/workflows/night-run.yml";
  const runs = scheduledCommands(path, "tests");
  expect(runs.some((command) => invokes(command, ["bun", "src/testing/test.ts", "--tier=live"]))).toBe(true);
  expect(runs.some((command) => invokes(command, ["bun", "src/testing/test.ts", "--tier=unit"]))).toBe(true);
  expect(runs.some((command) => invokes(command, ["bun", "src/testing/test.ts", "--tier=e2e"]))).toBe(true);
});

test("rejects a live tier that resolves away from the moved suites", () => {
  expect(MOVED.length).toBe(4);
  const options = testOptions(["--tier=live"]);
  expect(options).toEqual({ tier: "live" });
  expect(selectSuite(options ?? {}, "ci")).toEqual({ kind: "tier", tier: "live" });
  expect(suiteArgs({ kind: "tier", tier: "live" }, [])).toEqual(["--path-ignore-patterns", "", "./tests/live"]);
  expect(suiteArgs({ kind: "tier", tier: "e2e" }, [])).toEqual(["./tests/e2e"]);
});
