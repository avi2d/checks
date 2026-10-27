import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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

const WATCH_LIST = ["checks-secrets", "checks-graphwalk"] as const;

const MOVED = ["browser.test.ts", "stryker-consumer.test.ts", "stryker-consumer-config.test.ts", "stryker-consumer-runtime-read.test.ts"] as const;

const binsOf = (gates: readonly { readonly bin: string }[]): readonly string[] => gates.map(({ bin }) => bin).toSorted();

test("retiring gates to the night run never skips secrets or graphwalk on a per-PR run", () => {
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

function jobRecord(path: string, jobId: string): Record<string, unknown> | undefined {
  const text = readFileSync(resolve(import.meta.dir, "..", "..", path), "utf8");
  const workflow = Effect.runSync(parseWorkflow(path, text));
  const job = new Map(workflowJobs(workflow)).get(jobId);
  return isRecord(job) && !disabled(job) ? job : undefined;
}

function jobNeeds(path: string, jobId: string): readonly string[] {
  const needs = jobRecord(path, jobId)?.["needs"];
  return Array.isArray(needs) ? needs.filter((entry): entry is string => typeof entry === "string") : [];
}

function artifactNames(path: string, jobId: string, direction: "upload-artifact" | "download-artifact"): readonly string[] {
  const steps = jobRecord(path, jobId)?.["steps"];
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step) => {
    if (!isRecord(step) || typeof step["uses"] !== "string" || !step["uses"].startsWith(`actions/${direction}`)) return [];
    const withValue = step["with"];
    return isRecord(withValue) && typeof withValue["name"] === "string" ? [withValue["name"]] : [];
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

test("rejects a report job that files the night without the gates job behind it", () => {
  expect(jobNeeds(".github/workflows/night-run.yml", "report")).toEqual(["mutation", "gates", "tests"]);
});

test("rejects a gates log the report never files as a night-run issue", () => {
  const path = ".github/workflows/night-run.yml";
  expect(artifactNames(path, "gates", "upload-artifact")).toContain("night-run-gates");
  expect(artifactNames(path, "report", "download-artifact")).toContain("night-run-gates");
  const runs = scheduledCommands(path, "report");
  expect(runs.some((command) => invokes(command, ["bun", "src/testing/night-run.ts"]))).toBe(true);
  const run = nightRunStep(path)?.["run"];
  expect(typeof run === "string" ? expressionsOf(run) : []).toContain(GATES_EXPRESSION);
});

function nightRunStep(path: string): Record<string, unknown> | undefined {
  const steps = jobRecord(path, "report")?.["steps"];
  if (!Array.isArray(steps)) return undefined;
  const step = steps.find((entry) => isRecord(entry) && typeof entry["run"] === "string" && entry["run"].includes("src/testing/night-run.ts"));
  return isRecord(step) ? step : undefined;
}

function expressionsOf(run: string): readonly string[] {
  return [...run.matchAll(/\$\{\{\s*([\s\S]*?)\s*\}\}/g)].map((match) => (match[1] ?? "").trim());
}

const MUTATION_EXPRESSION = "needs.mutation.result == 'success' && '--mutation reports/mutation/mutation.json' || ''";
const GATES_EXPRESSION = "needs.gates.result == 'success' && '--gates reports/night-run-gates/gates.log' || ''";

function downloadCondition(path: string, jobId: string, artifact: string): unknown {
  const steps = jobRecord(path, jobId)?.["steps"];
  if (!Array.isArray(steps)) return undefined;
  const step = steps.find(
    (entry) =>
      isRecord(entry) &&
      typeof entry["uses"] === "string" &&
      entry["uses"].startsWith("actions/download-artifact") &&
      isRecord(entry["with"]) &&
      entry["with"]["name"] === artifact,
  );
  return isRecord(step) ? step["if"] : undefined;
}

test("rejects a gates flag moved out of its result guard", () => {
  const path = ".github/workflows/night-run.yml";
  expect(downloadCondition(path, "report", "night-run-gates")).toBe("needs.gates.result == 'success'");
  expect(downloadCondition(path, "report", "night-run-mutation")).toBe("needs.mutation.result == 'success'");
  const run = nightRunStep(path)?.["run"];
  expect(typeof run === "string" ? expressionsOf(run) : []).toEqual([MUTATION_EXPRESSION, GATES_EXPRESSION]);
});

test("rejects a live tier with a moved suite filed back under e2e", () => {
  for (const file of MOVED) {
    expect(existsSync(resolve(import.meta.dir, "..", "..", "tests", "live", file))).toBe(true);
    expect(existsSync(resolve(import.meta.dir, "..", "..", "tests", "e2e", file))).toBe(false);
  }
});

test("rejects a live tier that resolves away from the moved suites", () => {
  expect(MOVED.length).toBe(4);
  const options = testOptions(["--tier=live"]);
  expect(options).toEqual({ tier: "live" });
  expect(selectSuite(options ?? {}, "ci")).toEqual({ kind: "tier", tier: "live" });
  expect(suiteArgs({ kind: "tier", tier: "live" }, [])).toEqual(["--path-ignore-patterns", "", "./tests/live"]);
  expect(suiteArgs({ kind: "tier", tier: "e2e" }, [])).toEqual(["./tests/e2e"]);
});
