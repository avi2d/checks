import { expect, test } from "bun:test";
import { Effect } from "effect";
import { readFile } from "node:fs/promises";
import { Usage } from "../scripts/main.ts";
import { parseKillRun, ReportError } from "../scripts/mutation-compare.ts";
import { analyze, bailWarning, formatReport, parseArgs, type Report } from "../scripts/subsumed-tests.ts";

const FIXTURES = new URL("./fixtures/subsumed-tests/", import.meta.url);
const WIDE = "tests/add.test.ts > add covers every operator";
const NARROW = "tests/add.test.ts > add sums two numbers";
const TWIN_A = "tests/mul.test.ts > mul multiplies";
const TWIN_B = "tests/mul.test.ts > mul multiplies in either order";
const LONER = "tests/mul.test.ts > mul checks its guard";
const IDLE = "tests/mul.test.ts > mul names its label";

async function fixture(name: string): Promise<Report> {
  const text = await readFile(new URL(name, FIXTURES), "utf8");
  return analyze(Effect.runSync(parseKillRun(name, text)));
}

async function withConfig(config: object | undefined): Promise<string> {
  const { config: _recorded, ...report } = JSON.parse(await readFile(new URL("report.json", FIXTURES), "utf8"));
  return JSON.stringify(config === undefined ? report : { ...report, config });
}

function bailOf(text: string): string | undefined {
  return Effect.runSync(parseKillRun("report.json", text).pipe(Effect.flatMap((run) => bailWarning("report.json", run))));
}

test("a subsumed pair names the test and its subsumer by file and name with both kill counts", async () => {
  const report = await fixture("report.json");
  expect(report.subsumed).toEqual([{ test: NARROW, kills: 1, subsumedBy: WIDE, subsumerKills: 3 }]);
  const text = formatReport(report);
  expect(text).toContain(`${JSON.stringify(NARROW)} (1 kill) subsumed by ${JSON.stringify(WIDE)} (3 kills)`);
});

test("an identical pair is grouped apart from subsumption", async () => {
  const report = await fixture("report.json");
  expect(report.identical).toEqual([{ tests: [TWIN_A, TWIN_B], kills: 2 }]);
  expect(report.subsumed.map((one) => one.test)).not.toContain(TWIN_A);
  expect(report.subsumed.map((one) => one.test)).not.toContain(TWIN_B);
  expect(formatReport(report)).toContain(`${JSON.stringify(TWIN_A)} (2 kills) = ${JSON.stringify(TWIN_B)} (2 kills)`);
});

test("a test with a unique kill or no kill is listed nowhere", async () => {
  const report = await fixture("report.json");
  for (const name of [LONER, IDLE]) {
    expect(report.subsumed.map((one) => one.test)).not.toContain(name);
    expect(report.identical.flatMap((group) => group.tests)).not.toContain(name);
  }
});

test("the greedy cover keeps every kill out of every test the run listed", async () => {
  const report = await fixture("report.json");
  expect(report.cover.kills).toBe(6);
  expect(report.cover.tests).toBe(6);
  expect(report.cover.members).toEqual([WIDE, TWIN_A, LONER]);
  expect(formatReport(report)).toContain("greedy cover: 3 of 6 test(s) keep all 6 kill(s)");
});

test("the report opens with the files the run mutated", async () => {
  const report = await fixture("report.json");
  expect(report.files).toEqual(["src/add.ts", "src/mul.ts"]);
  const text = formatReport(report);
  expect(text.indexOf("mutated src/add.ts")).toBeLessThan(text.indexOf("subsumed tests"));
});

test("only the report path parses", () => {
  expect(Effect.runSync(parseArgs(["report.json"])).reportPath).toBe("report.json");
  expect(() => Effect.runSync(parseArgs([]))).toThrow(Usage);
  expect(() => Effect.runSync(parseArgs(["a.json", "b.json"]))).toThrow(Usage);
});

test("a report without a files or a testFiles table is refused", () => {
  expect(() => Effect.runSync(parseKillRun("report", "{}"))).toThrow(ReportError);
  expect(() => Effect.runSync(parseKillRun("report", '{"files": {}}'))).toThrow(ReportError);
});

test("a bail-off report reads without a warning", async () => {
  expect(bailOf(await withConfig({ disableBail: true }))).toBeUndefined();
});

test("a report built with bail on is refused with the flag that rebuilds it", async () => {
  for (const config of [{ disableBail: false }, {}]) {
    const text = await withConfig(config);
    expect(() => bailOf(text)).toThrow(ReportError);
    expect(() => bailOf(text)).toThrow(/config\.disableBail is not true.*bunx stryker run --disableBail/);
  }
});

test("a report without a config warns once and still reads", async () => {
  const text = await withConfig(undefined);
  expect(bailOf(text)).toBe("report.json records no config, so nothing shows whether bail was off: build it with `bunx stryker run --disableBail`");
  expect(analyze(Effect.runSync(parseKillRun("report.json", text))).subsumed).toHaveLength(1);
});
