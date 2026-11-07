import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { selectSuite, suiteArgs, testOptions } from "../../src/testing/test.ts";
import { KIT_GATES, PR_GATES, WHOLE_TREE_GATES } from "../../src/core/gates.ts";

const RETIRED = [
  "checks-lint-coverage",
  "checks-quarantine-clock",
  "checks-suppressions-ratchet",
  "checks-repetition",
] as const;

const WATCH_LIST = ["checks-secrets", "checks-graphwalk"] as const;

const MOVED = ["browser.test.ts", "stryker-consumer.test.ts", "stryker-consumer-config.test.ts", "stryker-consumer-runtime-read.test.ts"] as const;

const binsOf = (gates: readonly { readonly bin: string }[]): readonly string[] => gates.map(({ bin }) => bin).toSorted();

test("retiring gates to the whole-tree run never skips secrets or graphwalk on a per-PR run", () => {
  expect(binsOf(WHOLE_TREE_GATES)).toEqual([...RETIRED].toSorted());
  expect(binsOf(PR_GATES)).toEqual(binsOf(KIT_GATES).filter((bin) => !(RETIRED as readonly string[]).includes(bin)));
  for (const bin of WATCH_LIST) expect(PR_GATES.some((gate) => gate.bin === bin)).toBe(true);
  for (const bin of RETIRED) expect(PR_GATES.some((gate) => gate.bin === bin)).toBe(false);
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
