import { expect, test } from "bun:test";
import { fullRunRefusal } from "../../src/testing/mutation-scope.js";

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

const reportPresent = () => true;
const reportMissing = () => false;

test("only the enabling --incremental flag scopes a run", () => {
  expect(fullRunRefusal(["--incremental"], "", reportPresent)).toBeUndefined();
  expect(fullRunRefusal(["--incrementalFile", "reports/mutation/incremental.json"], "")).toBeDefined();
  expect(fullRunRefusal(["--incremental=false"], "")).toBeDefined();
  expect(fullRunRefusal(["--incremental", "--force"], "", reportPresent)).toBeDefined();
});

test("an --incremental run with no report to reuse is refused and names both ways forward", () => {
  const refusal = fullRunRefusal(["--incremental"], "", reportMissing);
  expect(refusal).toContain("reports/stryker-incremental.json");
  expect(refusal).toContain("mutation-report");
  expect(refusal).toContain("--mutate <glob>");
  expect(fullRunRefusal(["--incremental", "--mutate", "src/billing.ts"], "", reportMissing)).toBeUndefined();
  expect(fullRunRefusal(["--incremental"], "true", reportMissing)).toBeUndefined();
});

test("the incremental report checked is the one --incrementalFile names, else the default", () => {
  const checked: string[] = [];
  const record = (path: string) => {
    checked.push(path);
    return true;
  };
  fullRunRefusal(["--incremental"], "", record);
  fullRunRefusal(["--incremental", "--incrementalFile", "reports/a.json"], "", record);
  fullRunRefusal(["--incremental", "--incrementalFile=reports/b.json"], "", record);
  expect(checked).toEqual(["reports/stryker-incremental.json", "reports/a.json", "reports/b.json"]);
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
