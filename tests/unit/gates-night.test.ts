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

test("rejects a night workflow that mentions the night gates without an executable step, or that starts on a schedule rather than by hand", () => {
  const path = ".github/workflows/night-run.yml";
  expect(scheduledJobIds(path)).toEqual(["gates", "mutation", "report", "tests"]);
  expect(scheduledCrons(path)).toEqual([]);
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
  expect(typeof run === "string" && nightRunCommands(run, "success").some((command) => command.includes("--gates") && command.includes("reports/night-run-gates/gates.log"))).toBe(true);
});

function nightRunStep(path: string): Record<string, unknown> | undefined {
  const steps = jobRecord(path, "report")?.["steps"];
  if (!Array.isArray(steps)) return undefined;
  const step = steps.find((entry) => isRecord(entry) && typeof entry["run"] === "string" && entry["run"].includes("src/testing/night-run.ts"));
  return isRecord(step) ? step : undefined;
}

function truthy(value: string | boolean): boolean {
  return value !== false && value !== "";
}

function splitOutsideQuotes(text: string, operator: string): readonly string[] | undefined {
  const parts: string[] = [];
  let current = "";
  let single = false;
  let double = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" && !double) {
      single = !single;
      current += char;
    } else if (char === '"' && !single) {
      double = !double;
      current += char;
    } else if (!single && !double && text.startsWith(operator, index)) {
      parts.push(current);
      current = "";
      index += operator.length - 1;
    } else {
      current += char;
    }
  }
  if (parts.length === 0) return undefined;
  parts.push(current);
  return parts;
}

function unquoted(term: string): string | undefined {
  const trimmed = term.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return undefined;
}

function evaluatePrimary(term: string, gatesResult: string): string | boolean {
  const literal = unquoted(term);
  if (literal !== undefined) return literal;
  if (term.trim() === "needs.gates.result") return gatesResult;
  return term.trim();
}

function evaluateEquality(expr: string, gatesResult: string): string | boolean {
  const parts = splitOutsideQuotes(expr, "==");
  if (parts === undefined) return evaluatePrimary(expr, gatesResult);
  const values = parts.map((part) => evaluatePrimary(part.trim(), gatesResult));
  return values.every((value) => String(value) === String(values[0]));
}

function evaluateAnd(expr: string, gatesResult: string): string | boolean {
  const parts = splitOutsideQuotes(expr, "&&");
  const [first, ...rest] = parts ?? [];
  if (first === undefined) return evaluateEquality(expr, gatesResult);
  let result = evaluateEquality(first.trim(), gatesResult);
  for (const part of rest) {
    if (!truthy(result)) return result;
    result = evaluateEquality(part.trim(), gatesResult);
  }
  return result;
}

function evaluateOr(expr: string, gatesResult: string): string | boolean {
  const parts = splitOutsideQuotes(expr, "||");
  const [first, ...rest] = parts ?? [];
  if (first === undefined) return evaluateAnd(expr, gatesResult);
  let result = evaluateAnd(first.trim(), gatesResult);
  for (const part of rest) {
    if (truthy(result)) return result;
    result = evaluateAnd(part.trim(), gatesResult);
  }
  return result;
}

function renderedValue(value: string | boolean): string {
  return typeof value === "string" ? value : value ? "true" : "false";
}

function evaluateGuard(expr: string, gatesResult: string): string {
  return renderedValue(evaluateOr(expr, gatesResult));
}

function renderedCommands(run: string, gatesResult: string): readonly (readonly string[])[] {
  const rendered = run.replace(/\$\{\{\s*([\s\S]*?)\s*\}\}/g, (_substring: string, expr: string) => evaluateGuard(expr.trim(), gatesResult));
  return shellCommands(rendered).map((words) => fromProgram(words));
}

function nightRunCommands(run: string, gatesResult: string): readonly (readonly string[])[] {
  return renderedCommands(run, gatesResult).filter((command) => invokes(command, ["bun", "src/testing/night-run.ts"]));
}

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
  const run = nightRunStep(path)?.["run"];
  expect(typeof run === "string").toBe(true);
  if (typeof run !== "string") return;
  expect(nightRunCommands(run, "success").some((command) => command.includes("--gates") && command.includes("reports/night-run-gates/gates.log"))).toBe(true);
  expect(nightRunCommands(run, "failure").length).toBeGreaterThan(0);
  expect(nightRunCommands(run, "failure").every((command) => !command.includes("--gates"))).toBe(true);
});

function mutationShards(path: string): readonly string[] {
  const strategy = jobRecord(path, "mutation")?.["strategy"];
  const matrix = isRecord(strategy) ? strategy["matrix"] : undefined;
  const include = isRecord(matrix) ? matrix["include"] : undefined;
  return Array.isArray(include) ? include.flatMap((row) => (isRecord(row) && typeof row["shard"] === "string" ? [row["shard"]] : [])) : [];
}

function mutationDownload(path: string): Record<string, unknown> | undefined {
  const steps = jobRecord(path, "report")?.["steps"];
  if (!Array.isArray(steps)) return undefined;
  const step = steps.find((entry) => isRecord(entry) && isRecord(entry["with"]) && entry["with"]["pattern"] === "night-run-mutation-*");
  return isRecord(step) ? step : undefined;
}

test("rejects a report job that names no report for a mutation shard that timed out, so no finding names it", () => {
  const path = ".github/workflows/night-run.yml";
  const shards = mutationShards(path);
  expect(shards.length).toBeGreaterThan(1);
  expect(artifactNames(path, "mutation", "upload-artifact")).toEqual(["night-run-mutation-${{ matrix.shard }}"]);
  const download = mutationDownload(path);
  expect(download?.["if"]).toBeUndefined();
  expect(download?.["with"]).toEqual({ pattern: "night-run-mutation-*", path: "reports/mutation" });
  const reports = shards.flatMap((shard) => ["--mutation", `reports/mutation/night-run-mutation-${shard}/mutation.json`]);
  expect(scheduledCommands(path, "report").some((command) => invokes(command, ["bun", "src/testing/night-run.ts", ...reports]))).toBe(true);
});

test("rejects a mutation shard that cancels its siblings when it fails", () => {
  const strategy = jobRecord(".github/workflows/night-run.yml", "mutation")?.["strategy"];
  expect(isRecord(strategy) ? strategy["fail-fast"] : undefined).toBe(false);
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
