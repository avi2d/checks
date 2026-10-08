import { expect, test } from "bun:test";
import { fullRunRefusal, missingReportRefusal } from "../../src/testing/mutation-scope.js";

test("a full run outside CI is refused and names the CI command", () => {
  expect(fullRunRefusal([], "")).toContain("gh workflow run mutation");
  expect(fullRunRefusal(["--concurrency", "4"], "false")).toContain("gh workflow run mutation");
});

test("a run scoped to a named glob stays allowed locally, in any spelling", () => {
  expect(fullRunRefusal(["--mutate", "src/billing.ts"], "")).toBeUndefined();
  expect(fullRunRefusal(["--mutate=src/billing.ts"], "")).toBeUndefined();
  expect(fullRunRefusal(["-m", "src/billing.ts"], "")).toBeUndefined();
});

test("a --mutate without a glob is still a full run", () => {
  expect(fullRunRefusal(["--mutate"], "")).toBeDefined();
  expect(fullRunRefusal(["--mutate", ""], "")).toBeDefined();
  expect(fullRunRefusal(["-m"], "")).toBeDefined();
  expect(fullRunRefusal(["-m", ""], "")).toBeDefined();
  expect(fullRunRefusal(["--mutate="], "")).toBeDefined();
});

test("only the enabling --incremental flag scopes a run", () => {
  expect(fullRunRefusal(["--incremental"], "")).toBeUndefined();
  expect(fullRunRefusal(["--incrementalFile", "reports/mutation/incremental.json"], "")).toBeDefined();
  expect(fullRunRefusal(["--incremental=false"], "")).toBeDefined();
  expect(fullRunRefusal(["--incremental", "--force"], "")).toBeDefined();
});

const reportPresent = () => true;
const reportMissing = () => false;

test("an --incremental run with its report present stays allowed", () => {
  expect(missingReportRefusal(["--incremental"], "", "reports/stryker-incremental.json", reportPresent)).toBeUndefined();
});

test("an --incremental run with no report to reuse is refused and names both ways forward", () => {
  const refusal = missingReportRefusal(["--incremental"], "", "reports/custom.json", reportMissing);
  expect(refusal).toContain("no report at reports/custom.json");
  expect(refusal).toContain("gh workflow run mutation");
  expect(refusal).toContain("--mutate <glob>");
  expect(missingReportRefusal(["--incremental", "--mutate", "src/billing.ts"], "", "reports/custom.json", reportMissing)).toBeUndefined();
  expect(missingReportRefusal(["--incremental"], "true", "reports/custom.json", reportMissing)).toBeUndefined();
  expect(missingReportRefusal(["--incremental", "--help"], "", "reports/custom.json", reportMissing)).toBeUndefined();
});

test("the pull request comparison's own Stryker arguments stay allowed locally with no report to reuse", () => {
  const compare = ["--incremental", "--ignoreStatic", "--mutate", "src/billing.ts"];
  expect(fullRunRefusal(compare, "")).toBeUndefined();
  expect(missingReportRefusal(compare, "", "reports/stryker-incremental.json", reportMissing)).toBeUndefined();
  expect(fullRunRefusal(["--incremental", "--ignoreStatic", "--force"], "")).toBeDefined();
});

test("the report checked is the resolved incrementalFile it is given", () => {
  const checked: string[] = [];
  const record = (path: string) => {
    checked.push(path);
    return true;
  };
  missingReportRefusal(["--incremental"], "", "reports/custom.json", record);
  expect(checked).toEqual(["reports/custom.json"]);
});

test("every run stays allowed with CI=true", () => {
  expect(fullRunRefusal([], "true")).toBeUndefined();
  expect(fullRunRefusal(["--incremental", "--force"], "true")).toBeUndefined();
});

test("help and version are not runs, so they pass through", () => {
  expect(fullRunRefusal(["--help"], "")).toBeUndefined();
  expect(fullRunRefusal(["-h"], "")).toBeUndefined();
  expect(fullRunRefusal(["--version"], "")).toBeUndefined();
});
