import { expect, test } from "bun:test";
import { Option } from "effect";
import { newestFirst, pruneReport, pruned, superseded, uploadedBy } from "../../src/testing/mutation-baseline.ts";
import { outlived, withoutReasons, withoutStale } from "../../src/testing/mutation-baseline-saved.ts";

// GitHub numbers artifacts in the order it creates them, so a higher id is a newer artifact.
test("pruning keeps the highest artifact ids and the one being restored, and passes over a name that is no id", () => {
  expect(pruned(["9", "100", ".staging-ab12", "11", "2"], 2, "100")).toEqual(["9", "2"]);
  expect(pruned(["9", "100", ".staging-ab12", "11", "2"], 2, "2")).toEqual(["9"]);
  expect(pruned(["5"], 2, "5")).toEqual([]);
});

test("full candidates from two event lists merge newest first by creation time", () => {
  const runs = [
    { databaseId: 1, event: "schedule", createdAt: "2026-10-01T00:00:00Z" },
    { databaseId: 3, event: "schedule", createdAt: "2026-10-08T00:00:00Z" },
    { databaseId: 2, event: "workflow_dispatch", createdAt: "2026-10-04T12:30:00Z" },
  ];
  expect(newestFirst(runs)).toEqual([3, 2, 1]);
});

function artifact(id: number, name: string, expired = false, run = 10) {
  return { id, name, expired, workflow_run: { id: run, repository_id: 4242 } };
}

test("superseded keeps the newest of each baseline name, expired artifacts and other names", () => {
  const artifacts = [
    artifact(300, "mutation-baseline"),
    artifact(200, "mutation-baseline"),
    artifact(350, "mutation-baseline-full"),
    artifact(100, "mutation-baseline", true),
    artifact(999, "other"),
  ];
  expect(superseded(artifacts, new Set([200, 350]))).toEqual([artifact(300, "mutation-baseline")]);
  expect(superseded(artifacts, new Set([200, 300, 350]))).toEqual([]);
});

test("uploadedBy keeps the running run's unexpired baselines and nothing without a running run", () => {
  const artifacts = [
    artifact(450, "mutation-baseline-full", false, 40),
    artifact(400, "mutation-baseline", false, 40),
    artifact(410, "other", false, 40),
    artifact(420, "mutation-baseline", true, 40),
    artifact(200, "mutation-baseline", false, 20),
  ];
  expect(uploadedBy(artifacts, Option.some(40))).toEqual([
    { run: 40, id: 400, name: "mutation-baseline" },
    { run: 40, id: 450, name: "mutation-baseline-full" },
  ]);
  expect(uploadedBy(artifacts, Option.none())).toEqual([]);
});

test("withoutStale drops stale tests, changed sources, and static non-killed results from the incremental state", () => {
  const killed = { status: "Killed", coveredBy: ["0"], killedBy: ["1"] };
  const state = {
    files: {
      "src/changed.ts": { mutants: [killed] },
      "src/other.ts": { mutants: [{ status: "Survived", static: true, coveredBy: [] }, killed] },
    },
    testFiles: { "tests/unit/a.test.ts": { tests: [{ id: "0" }] }, "tests/unit/b.test.ts": { tests: [{ id: "1" }] } },
  };
  expect(withoutStale(state, { tests: new Set(["tests/unit/b.test.ts"]), sources: new Set(["src/changed.ts"]) })).toEqual({
    state: {
      files: { "src/other.ts": { mutants: [killed] } },
      testFiles: { "tests/unit/a.test.ts": { tests: [{ id: "0" }] } },
    },
    tests: ["tests/unit/b.test.ts"],
    sources: ["src/changed.ts", "src/other.ts"],
  });
  const untouched = withoutStale(state, { tests: new Set([]), sources: new Set([]) });
  expect(untouched).toEqual({ state, tests: [], sources: [] });
  expect(untouched.state).toBe(state);
  expect(withoutStale("not a state", { tests: new Set(["tests/unit/a.test.ts"]), sources: new Set([]) }).state).toBe("not a state");
});

test("withoutStale drops static non-killed results when the stale test is new to the state", () => {
  const killed = { status: "Killed", coveredBy: ["0"], killedBy: ["0"] };
  const state = {
    files: { "src/other.ts": { mutants: [{ status: "Survived", static: true, coveredBy: [] }, killed] } },
    testFiles: { "tests/unit/a.test.ts": { tests: [{ id: "0" }] } },
  };
  expect(withoutStale(state, { tests: new Set(["tests/unit/b.test.ts"]), sources: new Set([]) })).toEqual({
    state: {
      files: { "src/other.ts": { mutants: [killed] } },
      testFiles: { "tests/unit/a.test.ts": { tests: [{ id: "0" }] } },
    },
    tests: [],
    sources: ["src/other.ts"],
  });
});

test("withoutStale drops every non-killed mutant whenever any test goes stale, even those covered only by fresh tests", () => {
  const state = {
    files: {
      "src/mixed.ts": {
        mutants: [
          { status: "Survived", coveredBy: ["0"] },
          { status: "Survived", coveredBy: ["1"] },
          { status: "Survived", coveredBy: [], killedBy: [] },
          { status: "Killed", coveredBy: ["0"], killedBy: ["0"] },
        ],
      },
    },
    testFiles: { "tests/unit/a.test.ts": { tests: [{ id: "0" }] }, "tests/unit/b.test.ts": { tests: [{ id: "1" }] } },
  };
  expect(withoutStale(state, { tests: new Set(["tests/unit/a.test.ts"]), sources: new Set([]) })).toEqual({
    state: {
      files: {
        "src/mixed.ts": {
          mutants: [{ status: "Killed", coveredBy: ["0"], killedBy: ["0"] }],
        },
      },
      testFiles: { "tests/unit/b.test.ts": { tests: [{ id: "1" }] } },
    },
    tests: ["tests/unit/a.test.ts"],
    sources: ["src/mixed.ts"],
  });
});

// GitHub's workflow command syntax reads one annotation per line and decodes %25, %0D and %0A in its message.
test("pruneReport names the deleted, the missed and the kept artifacts", () => {
  const keeping = [
    { run: 20, id: 200, name: "mutation-baseline" },
    { run: 35, id: 350, name: "mutation-baseline-full" },
  ];
  expect(pruneReport(false, [100, 250, 300], [], keeping, Option.none())).toBe(
    "mutation-baseline: deleted artifacts 100, 250, 300; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35",
  );
  const missed = [
    { id: 250, name: "mutation-baseline-full", error: "gh api -X DELETE repos/{owner}/{repo}/actions/artifacts/250: HTTP 403: Resource not accessible" },
    { id: 300, name: "mutation-baseline", error: "gh api -X DELETE repos/{owner}/{repo}/actions/artifacts/300: HTTP 502: 100% down\r\nretry later" },
  ];
  expect(pruneReport(false, [100], missed, keeping, Option.none()).split("\n")).toEqual([
    "::warning::mutation-baseline: could not delete mutation-baseline-full artifact 250: gh api -X DELETE repos/{owner}/{repo}/actions/artifacts/250: HTTP 403: Resource not accessible",
    "::warning::mutation-baseline: could not delete mutation-baseline artifact 300: gh api -X DELETE repos/{owner}/{repo}/actions/artifacts/300: HTTP 502: 100%25 down%0D%0Aretry later",
    "mutation-baseline: deleted artifacts 100; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35; could not delete artifacts 250, 300",
  ]);
  expect(pruneReport(false, [], [], keeping, Option.none())).toBe(
    "mutation-baseline: nothing to delete; kept mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35",
  );
  expect(pruneReport(true, [100, 250, 300], [], keeping, Option.none())).toBe(
    "mutation-baseline: dry run, would delete artifacts 100, 250, 300; would keep mutation-baseline artifact 200 from run 20, mutation-baseline-full artifact 350 from run 35",
  );
  expect(pruneReport(true, [], [], [], Option.none())).toBe("mutation-baseline: dry run, nothing to delete; would keep no baseline artifacts");
  expect(pruneReport(false, [200], [], keeping.slice(1), Option.some(40))).toBe(
    "mutation-baseline: deleted artifacts 200; kept mutation-baseline-full artifact 350 from run 35, the mutation-baseline run 40 saved on the runner's disk",
  );
});

// GitHub numbers runs in the order it creates them, so an entry below the restored run belongs to an older run.
test("outlived names the saved entries older than the restored one, and never a newer run's or a staging directory", () => {
  expect(outlived(["9.json", "10.json", "40.json", ".staging-ab12", "50.json"], 40)).toEqual(["9.json", "10.json"]);
  expect(outlived(["40.json"], 40)).toEqual([]);
});

// The mutation-testing-report-schema makes statusReason optional on a mutant, so a report without it still validates.
test("withoutReasons drops each mutant's statusReason and keeps every other key of the report", () => {
  const report = {
    schemaVersion: "2",
    thresholds: { high: 80, low: 60 },
    testFiles: { "tests/unit/a.test.ts": { tests: [{ id: "0", name: "a" }] } },
    files: {
      "src/a.ts": {
        language: "typescript",
        source: "export const a = 1;",
        mutants: [
          { id: "1", status: "Killed", statusReason: "expect(received).toBe(expected)", killedBy: ["0"], coveredBy: ["0"] },
          { id: "2", status: "Survived", coveredBy: ["0"] },
        ],
      },
      "src/b.ts": { language: "typescript", source: "", mutants: [] },
    },
  };
  expect(withoutReasons(report)).toEqual({
    ...report,
    files: {
      ...report.files,
      "src/a.ts": {
        ...report.files["src/a.ts"],
        mutants: [
          { id: "1", status: "Killed", killedBy: ["0"], coveredBy: ["0"] },
          { id: "2", status: "Survived", coveredBy: ["0"] },
        ],
      },
    },
  });
  expect(withoutReasons({ files: [] })).toEqual({ files: [] });
});
