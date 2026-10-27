import { expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { readFile } from "node:fs/promises";
import { parseReport as parseMutationReport } from "../../src/testing/mutation-compare.ts";
import { fileFindings, Issues, issueBody, markedKey, marker, parseArgs, titleOf, type OpenIssue } from "../../src/testing/night-run.ts";
import { type Finding, findingsOf, gatesOf, keyOf, type NightRecord, type PreviousNight, scoresOf, type TestReport } from "../../src/testing/night-run-findings.ts";
import { parseReport as parseTestReport } from "../../src/testing/test-report.ts";
import { Usage } from "../../src/core/main.ts";

const FIXTURES = new URL("../fixtures/night-run/", import.meta.url);
const RUN = "https://github.com/acme/widget/actions/runs/12";
const LAST_NIGHT = "https://github.com/acme/widget/actions/runs/11";

const fixture = (name: string): Promise<string> => readFile(new URL(name, FIXTURES), "utf8");

async function testReport(name: string): Promise<TestReport> {
  return Effect.runPromise(parseTestReport(await fixture(name)));
}

function lastNight(scores: NightRecord["scores"]): Option.Option<PreviousNight> {
  return Option.some({ url: LAST_NIGHT, record: { scores } });
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
  const tonight = { scores: { "src/cart.ts": { detected: 9, valid: 10 }, "src/session.ts": { detected: 5, valid: 5 } }, tests: [await testReport("passing.xml")] };

  expect(findingsOf(lastNight(PREVIOUS), tonight)).toEqual([]);
});

test("a lower score on one file files that file alone, from last night's score to tonight's", () => {
  const tonight = { scores: { "src/cart.ts": { detected: 8, valid: 10 }, "src/session.ts": { detected: 4, valid: 5 } }, tests: [] };

  expect(findingsOf(lastNight(PREVIOUS), tonight)).toEqual([
    { kind: "mutation", file: "src/cart.ts", before: { detected: 9, valid: 10 }, after: { detected: 8, valid: 10 }, since: LAST_NIGHT },
  ]);
});

test("an equal score reached through other counts is no finding", () => {
  const tonight = { scores: { "src/cart.ts": { detected: 18, valid: 20 }, "src/session.ts": { detected: 8, valid: 10 } }, tests: [] };

  expect(findingsOf(lastNight(PREVIOUS), tonight)).toEqual([]);
});

test("a new file has no score to fall from, and a file with no scored mutant has no score", () => {
  const tonight = { scores: { ...PREVIOUS, "src/new.ts": { detected: 1, valid: 4 }, "src/session.ts": { detected: 0, valid: 0 } }, tests: [] };

  expect(findingsOf(lastNight(PREVIOUS), tonight)).toEqual([]);
});

test("each failing test is filed by its file and full name, and a crashed worker's file once", async () => {
  const tonight = { scores: PREVIOUS, tests: [await testReport("failing.xml")] };

  const findings = findingsOf(lastNight(PREVIOUS), tonight);

  expect(findings).toEqual([
    { kind: "test", file: "tests/unit/cart.test.ts", name: "totals > rounds half to even" },
    { kind: "crash", file: "tests/unit/session.test.ts" },
  ]);
  expect(findings.map(keyOf)).toEqual(["test:tests/unit/cart.test.ts > totals > rounds half to even", "test:tests/unit/session.test.ts"]);
});

test("with no previous night no score is compared, and a failing test is still filed", async () => {
  const tonight = { scores: { "src/cart.ts": { detected: 1, valid: 10 } }, tests: [await testReport("failing.xml")] };

  expect(findingsOf(Option.none(), tonight).map(keyOf)).toEqual(["test:tests/unit/cart.test.ts > totals > rounds half to even", "test:tests/unit/session.test.ts"]);
});

test("the same failing test in two reports is one finding", async () => {
  const report = await testReport("failing.xml");

  expect(findingsOf(Option.none(), { scores: {}, tests: [report, report] })).toHaveLength(2);
});

type Call = { readonly method: string; readonly args: readonly unknown[] };

function recordingIssues(open: readonly OpenIssue[]): { readonly layer: Layer.Layer<Issues>; readonly calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: string, ...args: readonly unknown[]) => Effect.sync(() => void calls.push({ method, args }));
  const layer = Layer.succeed(
    Issues,
    Issues.of({
      ensureLabel: record("ensureLabel"),
      open: record("open").pipe(Effect.as(open)),
      create: (title, body) => record("create", title, body).pipe(Effect.as(41)),
      comment: (issue, body) => record("comment", issue, body),
    }),
  );
  return { layer, calls };
}

const FELL: Finding = { kind: "mutation", file: "src/cart.ts", before: { detected: 9, valid: 10 }, after: { detected: 8, valid: 10 }, since: LAST_NIGHT };

test("a finding with a new key opens one issue that names the run, the file and the score change", async () => {
  const issues = recordingIssues([{ number: 7, key: "test:tests/unit/other.test.ts > passes" }]);

  const filed = await Effect.runPromise(fileFindings([FELL], RUN).pipe(Effect.provide(issues.layer)));

  expect(filed).toEqual([{ key: "mutation:src/cart.ts", issue: 41, action: "opened" }]);
  expect(issues.calls.map((call) => call.method)).toEqual(["ensureLabel", "open", "create"]);
  const [, , create] = issues.calls;
  expect(create?.args[0]).toBe("Night run: mutation score fell in src/cart.ts");
  expect(create?.args[1]).toContain(RUN);
  expect(create?.args[1]).toContain(LAST_NIGHT);
  expect(create?.args[1]).toContain("| `src/cart.ts` | 90.00%, 9 of 10 mutants detected | 80.00%, 8 of 10 mutants detected |");
});

test("a finding whose key an open issue holds comments on that issue once and opens none", async () => {
  const issues = recordingIssues([{ number: 7, key: "mutation:src/cart.ts" }]);

  const filed = await Effect.runPromise(fileFindings([FELL], RUN).pipe(Effect.provide(issues.layer)));

  expect(filed).toEqual([{ key: "mutation:src/cart.ts", issue: 7, action: "commented on" }]);
  expect(issues.calls.map((call) => call.method)).toEqual(["ensureLabel", "open", "comment"]);
  expect(issues.calls[2]?.args[0]).toBe(7);
  expect(issues.calls[2]?.args[1]).toContain(RUN);
});

test("no finding makes no call at all", async () => {
  const issues = recordingIssues([{ number: 7, key: "mutation:src/cart.ts" }]);

  expect(await Effect.runPromise(fileFindings([], RUN).pipe(Effect.provide(issues.layer)))).toEqual([]);
  expect(issues.calls).toEqual([]);
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

  await Effect.runPromise(fileFindings([finding], RUN).pipe(Effect.provide(issues.layer)));

  const [, , create] = issues.calls;
  const [title, body] = create?.args ?? [];
  expect(title).toHaveLength(256);
  expect(String(title).startsWith("Night run: tests/e2e/browser.test.ts > renders a very long scenario name")).toBe(true);
  expect(body).toContain(name);
  expect(body).toContain("tests/e2e/browser.test.ts");
  expect(body).toContain(`Finding key: \`test:tests/e2e/browser.test.ts > ${name}\``);
});

test("a title within GitHub's 256 characters stays whole, and a cut never splits a character", () => {
  expect(titleOf({ kind: "crash", file: "tests/unit/session.test.ts" })).toBe("Night run: tests/unit/session.test.ts crashed its test worker");
  const full = `Night run: tests/unit/emoji.test.ts > ${"😀".repeat(200)} fails`;
  const cut = titleOf({ kind: "test", file: "tests/unit/emoji.test.ts", name: "😀".repeat(200) });
  expect(cut.length).toBeLessThanOrEqual(256);
  expect(cut.isWellFormed()).toBe(true);
  expect(cut).not.toContain("\uFFFD");
  expect(cut.endsWith("…")).toBe(true);
  expect(full.startsWith(cut.slice(0, -1))).toBe(true);
});

test("checks-night-run takes at most one mutation report and any number of test reports", async () => {
  expect(await Effect.runPromise(parseArgs(["--mutation", "m.json", "--tests", "unit.xml", "--tests", "e2e.xml"]))).toEqual({ mutation: Option.some("m.json"), tests: ["unit.xml", "e2e.xml"], gates: Option.none() });
  expect(await Effect.runPromise(parseArgs(["--tests", "unit.xml"]))).toEqual({ mutation: Option.none(), tests: ["unit.xml"], gates: Option.none() });
  expect(await Effect.runPromise(parseArgs(["--gates", "gates.log"]))).toEqual({
    mutation: Option.none(),
    tests: [],
    gates: Option.some("gates.log"),
  });
  for (const argv of [[], ["--mutation"], ["--mutation", "a.json", "--mutation", "b.json"], ["--mutation", "--tests"], ["--report", "x"], ["--gates"], ["--gates", "a.log", "--gates", "b.log"], ["--gates", "--tests"]]) {
    expect(await Effect.runPromise(Effect.flip(parseArgs(argv)))).toBeInstanceOf(Usage);
  }
});

test("a failed nightly gate is filed under its own key instead of dropped silently", () => {
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
  const filed = await Effect.runPromise(fileFindings([{ kind: "gates", file: "checks-repetition" }], RUN).pipe(Effect.provide(issues.layer)));
  expect(filed).toEqual([{ key: "gates:checks-repetition", issue: 41, action: "opened" }]);
  const [, , create] = issues.calls;
  expect(create?.args[0]).toBe("Night run: nightly gate checks-repetition failed");
  expect(create?.args[1]).toContain(RUN);
  expect(create?.args[1]).toContain("Finding key: `gates:checks-repetition`");
});
