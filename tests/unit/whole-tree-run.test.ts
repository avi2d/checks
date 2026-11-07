import { expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { readFile } from "node:fs/promises";
import { parseReport as parseMutationReport } from "../../src/testing/mutation-compare.ts";
import { clearedText, fileFindings, Issues, issueBody, markedKey, marker, notedText, parseArgs, reportedText, titleOf, type OpenIssue } from "../../src/testing/whole-tree-run.ts";
import { type Finding, findingsOf, gatesDecided, gatesOf, keyOf, type Observed, type WholeTreeRecord, type PreviousRun, scoresOf, type TestReport } from "../../src/testing/whole-tree-run-findings.ts";
import { parseReport as parseTestReport } from "../../src/testing/test-report.ts";
import { Usage } from "../../src/core/main.ts";

const FIXTURES = new URL("../fixtures/whole-tree-run/", import.meta.url);
const RUN = "https://github.com/acme/widget/actions/runs/12";
const LAST_RUN = "https://github.com/acme/widget/actions/runs/11";

const fixture = (name: string): Promise<string> => readFile(new URL(name, FIXTURES), "utf8");

async function testReport(name: string): Promise<TestReport> {
  return Effect.runPromise(parseTestReport(await fixture(name)));
}

function lastRun(scores: WholeTreeRecord["scores"]): Option.Option<PreviousRun> {
  return Option.some({ url: LAST_RUN, record: { scores } });
}

const PREVIOUS = {
  "src/cart.ts": { detected: 9, valid: 10 },
  "src/session.ts": { detected: 4, valid: 5 },
};

test("Stryker's score counts Killed and Timeout as detected over every mutant but Ignored, CompileError, RuntimeError and Pending", async () => {
  const files = await Effect.runPromise(parseMutationReport("mutation.json", await fixture("mutation.json")));

  expect(scoresOf(files)).toEqual({
    "src/ignored.ts": { detected: 0, valid: 0 },
    "src/killed.ts": { detected: 2, valid: 2 },
    "src/mixed.ts": { detected: 2, valid: 4 },
  });
});

test("no regression: a score that holds or rises and a passing suite file nothing", async () => {
  const current = { scores: { "src/cart.ts": { detected: 9, valid: 10 }, "src/session.ts": { detected: 5, valid: 5 } }, tests: [await testReport("passing.xml")] };

  expect(findingsOf(lastRun(PREVIOUS), current)).toEqual([]);
});

test("a lower score on one file files that file alone, from last run's score to this run's", () => {
  const current = { scores: { "src/cart.ts": { detected: 8, valid: 10 }, "src/session.ts": { detected: 4, valid: 5 } }, tests: [] };

  expect(findingsOf(lastRun(PREVIOUS), current)).toEqual([
    { kind: "mutation", file: "src/cart.ts", before: { detected: 9, valid: 10 }, after: { detected: 8, valid: 10 }, since: LAST_RUN },
  ]);
});

test("an equal score reached through other counts is no finding", () => {
  const current = { scores: { "src/cart.ts": { detected: 18, valid: 20 }, "src/session.ts": { detected: 8, valid: 10 } }, tests: [] };

  expect(findingsOf(lastRun(PREVIOUS), current)).toEqual([]);
});

test("a new file has no score to fall from, and a file with no scored mutant has no score", () => {
  const current = { scores: { ...PREVIOUS, "src/new.ts": { detected: 1, valid: 4 }, "src/session.ts": { detected: 0, valid: 0 } }, tests: [] };

  expect(findingsOf(lastRun(PREVIOUS), current)).toEqual([]);
});

test("each failing test is filed by its file and full name, and a crashed worker's file once", async () => {
  const current = { scores: PREVIOUS, tests: [await testReport("failing.xml")] };

  const findings = findingsOf(lastRun(PREVIOUS), current);

  expect(findings).toEqual([
    { kind: "test", file: "tests/unit/cart.test.ts", name: "totals > rounds half to even" },
    { kind: "crash", file: "tests/unit/session.test.ts" },
  ]);
  expect(findings.map(keyOf)).toEqual(["test:tests/unit/cart.test.ts > totals > rounds half to even", "test:tests/unit/session.test.ts"]);
});

test("with no previous run no score is compared, and a failing test is still filed", async () => {
  const current = { scores: { "src/cart.ts": { detected: 1, valid: 10 } }, tests: [await testReport("failing.xml")] };

  expect(findingsOf(Option.none(), current).map(keyOf)).toEqual(["test:tests/unit/cart.test.ts > totals > rounds half to even", "test:tests/unit/session.test.ts"]);
});

test("the same failing test in two reports is one finding", async () => {
  const report = await testReport("failing.xml");

  expect(findingsOf(Option.none(), { scores: {}, tests: [report, report] })).toHaveLength(2);
});

type Call = { readonly method: string; readonly args: readonly unknown[] };

function recordingIssues(open: readonly OpenIssue[], earlier: ReadonlyMap<number, readonly string[]> = new Map()): { readonly layer: Layer.Layer<Issues>; readonly calls: Call[] } {
  const calls: Call[] = [];
  const posted = new Map([...earlier].map(([issue, bodies]) => [issue, [...bodies]]));
  const record = (method: string, ...args: readonly unknown[]) => Effect.sync(() => void calls.push({ method, args }));
  const layer = Layer.succeed(
    Issues,
    Issues.of({
      ensureLabel: record("ensureLabel"),
      open: record("open").pipe(Effect.as(open)),
      create: (title, body) => record("create", title, body).pipe(Effect.as(41)),
      comment: (issue, body) => record("comment", issue, body).pipe(Effect.andThen(Effect.sync(() => void posted.set(issue, [...(posted.get(issue) ?? []), body])))),
      close: (issue) => record("close", issue),
      comments: (issue) => record("comments", issue).pipe(Effect.as(posted.get(issue) ?? [])),
    }),
  );
  return { layer, calls };
}

const FELL: Finding = { kind: "mutation", file: "src/cart.ts", before: { detected: 9, valid: 10 }, after: { detected: 8, valid: 10 }, since: LAST_RUN };
const EVERY_REPORT: Observed = { tests: true, gates: true, mutation: true, mutationReports: new Set() };
const ROUNDS = "test:tests/unit/cart.test.ts > totals > rounds half to even";
const ROUNDS_FAILS: Finding = { kind: "test", file: "tests/unit/cart.test.ts", name: "totals > rounds half to even" };

async function file(findings: readonly Finding[], observed: Observed, open: readonly OpenIssue[]) {
  const issues = recordingIssues(open);
  const filed = await Effect.runPromise(fileFindings(findings, observed, RUN).pipe(Effect.provide(issues.layer)));
  return { filed, calls: issues.calls };
}

test("a finding with a new key opens one issue that names the run, the file and the score change", async () => {
  const issues = recordingIssues([{ number: 7, key: "mutation:src/other.ts" }]);

  const filed = await Effect.runPromise(fileFindings([FELL], EVERY_REPORT, RUN).pipe(Effect.provide(issues.layer)));

  expect(filed).toEqual([
    { key: "mutation:src/cart.ts", issue: 41, action: "opened" },
    { key: "mutation:src/other.ts", issue: 7, action: "commented on" },
  ]);
  expect(issues.calls.map((call) => call.method)).toEqual(["ensureLabel", "open", "create", "comments", "comment"]);
  const [, , create] = issues.calls;
  expect(create?.args[0]).toBe("Whole-tree run: mutation score fell in src/cart.ts");
  expect(create?.args[1]).toContain(RUN);
  expect(create?.args[1]).toContain(LAST_RUN);
  expect(create?.args[1]).toContain("| `src/cart.ts` | 90.00%, 9 of 10 mutants detected | 80.00%, 8 of 10 mutants detected |");
});

test("a finding whose key an open issue holds comments on that issue once and opens none", async () => {
  const issues = recordingIssues([{ number: 7, key: "mutation:src/cart.ts" }]);

  const filed = await Effect.runPromise(fileFindings([FELL], EVERY_REPORT, RUN).pipe(Effect.provide(issues.layer)));

  expect(filed).toEqual([{ key: "mutation:src/cart.ts", issue: 7, action: "commented on" }]);
  expect(issues.calls.map((call) => call.method)).toEqual(["ensureLabel", "open", "comment"]);
  expect(issues.calls[2]?.args[0]).toBe(7);
  expect(issues.calls[2]?.args[1]).toContain(RUN);
});

test("a failing test absent on a later run comments once and closes its issue instead of leaving it open", async () => {
  const { filed, calls } = await file([], EVERY_REPORT, [{ number: 7, key: ROUNDS }]);

  expect(filed).toEqual([{ key: ROUNDS, issue: 7, action: "closed" }]);
  expect(calls).toEqual([
    { method: "open", args: [] },
    { method: "comment", args: [7, clearedText(ROUNDS, RUN)] },
    { method: "close", args: [7] },
  ]);
  expect(clearedText(ROUNDS, RUN)).toContain(RUN);
  expect(clearedText(ROUNDS, RUN)).toContain(ROUNDS);
});

test("a failing test still present on this run is commented on and not closed", async () => {
  const { filed, calls } = await file([ROUNDS_FAILS], EVERY_REPORT, [{ number: 7, key: ROUNDS }]);

  expect(filed).toEqual([{ key: ROUNDS, issue: 7, action: "commented on" }]);
  expect(calls.map((call) => call.method)).toEqual(["ensureLabel", "open", "comment"]);
});

test("only the absent finding's issue closes, and a present one beside it stays open", async () => {
  const { filed } = await file([ROUNDS_FAILS], EVERY_REPORT, [
    { number: 7, key: ROUNDS },
    { number: 8, key: "gates:checks-repetition" },
  ]);

  expect(filed).toEqual([
    { key: ROUNDS, issue: 7, action: "commented on" },
    { key: "gates:checks-repetition", issue: 8, action: "closed" },
  ]);
});

test("a test issue stays open while its file crashed on this run, instead of closing on results the crash lost", async () => {
  const { filed, calls } = await file([{ kind: "crash", file: "tests/unit/cart.test.ts" }], EVERY_REPORT, [{ number: 7, key: ROUNDS }]);

  expect(filed).toEqual([{ key: "test:tests/unit/cart.test.ts", issue: 41, action: "opened" }]);
  expect(calls.map((call) => call.method)).toEqual(["ensureLabel", "open", "create"]);
});

test("a run that read no test report closes no test issue, and one with an undecided gate log closes no gate issue", async () => {
  const open = [
    { number: 7, key: ROUNDS },
    { number: 8, key: "test:tests/unit/session.test.ts" },
    { number: 9, key: "gates:checks-repetition" },
  ];

  const { filed, calls } = await file([], { tests: false, gates: false, mutation: false, mutationReports: new Set() }, open);

  expect(filed).toEqual([]);
  expect(calls.map((call) => call.method)).toEqual(["open"]);
});

test("a mutation issue absent on a later run is commented on once and stays open", async () => {
  const { filed, calls } = await file([], EVERY_REPORT, [{ number: 7, key: "mutation:src/cart.ts" }]);

  expect(filed).toEqual([{ key: "mutation:src/cart.ts", issue: 7, action: "commented on" }]);
  expect(calls).toEqual([
    { method: "open", args: [] },
    { method: "comments", args: [7] },
    { method: "comment", args: [7, notedText("mutation:src/cart.ts", RUN)] },
  ]);
  expect(notedText("mutation:src/cart.ts", RUN)).toContain(RUN);
  expect(notedText("mutation:src/cart.ts", RUN)).toContain("mutation:src/cart.ts");
});

test("a second and a third run without the mutation finding comment on its issue no more instead of repeating the note", async () => {
  const issues = recordingIssues([{ number: 7, key: "mutation:src/cart.ts" }]);
  const current = () => Effect.runPromise(fileFindings([], EVERY_REPORT, RUN).pipe(Effect.provide(issues.layer)));

  const first = await current();
  const second = await current();
  const third = await current();

  expect(first).toEqual([{ key: "mutation:src/cart.ts", issue: 7, action: "commented on" }]);
  expect([second, third]).toEqual([[], []]);
  expect(issues.calls.filter((call) => call.method === "comment")).toHaveLength(1);
  expect(issues.calls.filter((call) => call.method === "close")).toEqual([]);
});

test("a mutation finding that recovers, falls again and recovers again is noted twice instead of once for good", async () => {
  const issues = recordingIssues([{ number: 7, key: "mutation:src/cart.ts" }]);
  const run = (findings: readonly Finding[]) => Effect.runPromise(fileFindings(findings, EVERY_REPORT, RUN).pipe(Effect.provide(issues.layer)));

  await run([]);
  await run([FELL]);
  const absentAgain = await run([]);

  expect(absentAgain).toEqual([{ key: "mutation:src/cart.ts", issue: 7, action: "commented on" }]);
  expect(issues.calls.filter((call) => call.method === "comment").map((call) => call.args[1])).toEqual([
    notedText("mutation:src/cart.ts", RUN),
    reportedText(FELL, RUN),
    notedText("mutation:src/cart.ts", RUN),
  ]);
});

test("a person's comment after the note does not make a quiet run note the mutation issue again", async () => {
  const earlier = new Map([[7, [notedText("mutation:src/cart.ts", LAST_RUN), "A person asks whether this is fixed."]]]);
  const issues = recordingIssues([{ number: 7, key: "mutation:src/cart.ts" }], earlier);

  const filed = await Effect.runPromise(fileFindings([], EVERY_REPORT, RUN).pipe(Effect.provide(issues.layer)));

  expect(filed).toEqual([]);
  expect(issues.calls.map((call) => call.method)).toEqual(["open", "comments"]);
});

test("a mutation issue absent without a compared score stays silent", async () => {
  const { filed, calls } = await file([], { tests: false, gates: false, mutation: false, mutationReports: new Set() }, [{ number: 7, key: "mutation:src/cart.ts" }]);

  expect(filed).toEqual([]);
  expect(calls).toEqual([{ method: "open", args: [] }]);
});

test("a gate log decides gates when it passes or names failed gates, and not when it is undecided or never finished", () => {
  expect(gatesDecided("checks-lint: 4 gate(s) pass")).toBe(true);
  expect(gatesDecided("checks-lint: 1 of 4 gate(s) failed: checks-repetition")).toBe(true);
  expect(gatesDecided("checks-lint: 2 of 4 gate(s) undecided: checks-repetition, checks-suppressions-ratchet")).toBe(false);
  expect(gatesDecided("checks-lint: cannot run checks-repetition: boom")).toBe(false);
});

test("an issue body carries its key back, even a key holding quotes and a comment's closing", () => {
  const finding: Finding = { kind: "test", file: "tests/unit/cart.test.ts", name: 'parses "-->" and \\ back' };

  expect(markedKey(issueBody(finding, RUN))).toEqual(Option.some(keyOf(finding)));
  expect(marker(keyOf(finding)).split("-->")).toHaveLength(2);
  expect(markedKey("A body a person wrote")).toEqual(Option.none());
  expect(markedKey(null)).toEqual(Option.none());
});

test("a test name too long for GitHub's 256-character title keeps the title within it and the full name and key in the body", async () => {
  const name = `renders ${"a very long scenario name ".repeat(10)}`.trim();
  const finding: Finding = { kind: "test", file: "tests/e2e/browser.test.ts", name };
  const issues = recordingIssues([]);

  await Effect.runPromise(fileFindings([finding], EVERY_REPORT, RUN).pipe(Effect.provide(issues.layer)));

  const [, , create] = issues.calls;
  const [title, body] = create?.args ?? [];
  expect(title).toHaveLength(256);
  expect(String(title).startsWith("Whole-tree run: tests/e2e/browser.test.ts > renders a very long scenario name")).toBe(true);
  expect(body).toContain(name);
  expect(body).toContain("tests/e2e/browser.test.ts");
  expect(body).toContain(`Finding key: \`test:tests/e2e/browser.test.ts > ${name}\``);
});

test("a title within GitHub's 256 characters stays whole, and a cut never splits a character", () => {
  expect(titleOf({ kind: "crash", file: "tests/unit/session.test.ts" })).toBe("Whole-tree run: tests/unit/session.test.ts crashed its test worker");
  const full = `Whole-tree run: tests/unit/emoji.test.ts > ${"😀".repeat(200)} fails`;
  const cut = titleOf({ kind: "test", file: "tests/unit/emoji.test.ts", name: "😀".repeat(200) });
  expect(cut.length).toBeLessThanOrEqual(256);
  expect(cut.isWellFormed()).toBe(true);
  expect(cut).not.toContain("\uFFFD");
  expect(cut.endsWith("…")).toBe(true);
  expect(full.startsWith(cut.slice(0, -1))).toBe(true);
});

test("checks-whole-tree-run takes any number of mutation and test reports and at most one lint log", async () => {
  expect(await Effect.runPromise(parseArgs(["--mutation", "m.json", "--tests", "unit.xml", "--tests", "e2e.xml"]))).toEqual({ mutation: ["m.json"], tests: ["unit.xml", "e2e.xml"], gates: Option.none() });
  expect(await Effect.runPromise(parseArgs(["--mutation", "a.json", "--mutation", "b.json"]))).toEqual({ mutation: ["a.json", "b.json"], tests: [], gates: Option.none() });
  expect(await Effect.runPromise(parseArgs(["--tests", "unit.xml"]))).toEqual({ mutation: [], tests: ["unit.xml"], gates: Option.none() });
  expect(await Effect.runPromise(parseArgs(["--gates", "gates.log"]))).toEqual({
    mutation: [],
    tests: [],
    gates: Option.some("gates.log"),
  });
  for (const argv of [[], ["--mutation"], ["--mutation", "--tests"], ["--report", "x"], ["--gates"], ["--gates", "a.log", "--gates", "b.log"], ["--gates", "--tests"]]) {
    expect(await Effect.runPromise(Effect.flip(parseArgs(argv)))).toBeInstanceOf(Usage);
  }
});

test("a failed whole-tree gate is filed under its own key instead of dropped silently", () => {
  const log = [
    "checks-lint: tip 03da92c from the whole tree at HEAD",
    "checks-lint: 2 of 4 gate(s) failed: checks-repetition, checks-suppressions-ratchet",
  ].join("\n");
  expect(gatesOf(log)).toEqual([
    { kind: "gates", file: "checks-repetition" },
    { kind: "gates", file: "checks-suppressions-ratchet" },
  ]);
  expect(findingsOf(Option.none(), { scores: {}, tests: [] }, gatesOf(log)).map(keyOf)).toEqual([
    "gates:checks-repetition",
    "gates:checks-suppressions-ratchet",
  ]);
});

test("an all-undecided lint summary files checks-lint itself and no per-gate issue", () => {
  const log = [
    "checks-lint: tip 03da92c from the whole tree at HEAD",
    "checks-lint: 2 of 4 gate(s) undecided: checks-repetition, checks-suppressions-ratchet",
  ].join("\n");
  expect(gatesOf(log)).toEqual([{ kind: "gates", file: "checks-lint" }]);
});

test("a passing lint log files no gate, and a log with no verdict files checks-lint itself", () => {
  expect(gatesOf("checks-lint: 4 gate(s) pass")).toEqual([]);
  expect(gatesOf("checks-lint: cannot run checks-repetition: boom")).toEqual([{ kind: "gates", file: "checks-lint" }]);
});

test("a gates finding opens one issue that names the run and the failed gate", async () => {
  const issues = recordingIssues([]);
  const filed = await Effect.runPromise(fileFindings([{ kind: "gates", file: "checks-repetition" }], EVERY_REPORT, RUN).pipe(Effect.provide(issues.layer)));
  expect(filed).toEqual([{ key: "gates:checks-repetition", issue: 41, action: "opened" }]);
  const [, , create] = issues.calls;
  expect(create?.args[0]).toBe("Whole-tree run: whole-tree gate checks-repetition failed");
  expect(create?.args[1]).toContain(RUN);
  expect(create?.args[1]).toContain("Finding key: `gates:checks-repetition`");
});

test("a recovered shard report closes its issue while a still-missing one stays open instead of both staying open", async () => {
  const recovered = "reports/mutation/whole-tree-run-mutation-quality/mutation.json";
  const stillMissing = "reports/mutation/whole-tree-run-mutation-delivery/mutation.json";
  const missing: Finding = { kind: "mutation-report", file: stillMissing };
  const { filed, calls } = await file([missing], { ...EVERY_REPORT, mutationReports: new Set([recovered]) }, [
    { number: 7, key: `mutation-report:${recovered}` },
    { number: 8, key: `mutation-report:${stillMissing}` },
  ]);

  expect(filed).toEqual([
    { key: `mutation-report:${stillMissing}`, issue: 8, action: "commented on" },
    { key: `mutation-report:${recovered}`, issue: 7, action: "closed" },
  ]);
  expect(calls).toEqual([
    { method: "ensureLabel", args: [] },
    { method: "open", args: [] },
    { method: "comment", args: [8, reportedText(missing, RUN)] },
    { method: "comment", args: [7, clearedText(`mutation-report:${recovered}`, RUN)] },
    { method: "close", args: [7] },
  ]);
});

test("a missing mutation report opens one issue under its own key that names the run and the report", async () => {
  const issues = recordingIssues([]);
  const report = "reports/mutation/whole-tree-run-mutation-quality/mutation.json";
  const filed = await Effect.runPromise(fileFindings([{ kind: "mutation-report", file: report }], EVERY_REPORT, RUN).pipe(Effect.provide(issues.layer)));
  expect(filed).toEqual([{ key: `mutation-report:${report}`, issue: 41, action: "opened" }]);
  const [, , create] = issues.calls;
  expect(create?.args[0]).toBe(`Whole-tree run: no mutation report at ${report}`);
  expect(create?.args[1]).toContain(RUN);
  expect(create?.args[1]).toContain(`Finding key: \`mutation-report:${report}\``);
});
