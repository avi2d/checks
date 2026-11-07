import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { selectSuite, suiteArgs, testOptions } from "../../../src/testing/test.ts";
import { WHOLE_TREE_GATES } from "../../../src/core/gates.ts";

const WHOLE_TREE_SWEEP = [
  "checks-lint-coverage",
  "checks-quarantine-clock",
  "checks-suppressions-ratchet",
  "checks-repetition",
] as const;

const MOVED = ["browser.test.ts", "stryker-consumer.test.ts", "stryker-consumer-config.test.ts", "stryker-consumer-runtime-read.test.ts"] as const;

const binsOf = (gates: readonly { readonly bin: string }[]): readonly string[] => gates.map(({ bin }) => bin).toSorted();

test("rejects a whole-tree sweep that adds or drops one of the four gates", () => {
  expect(binsOf(WHOLE_TREE_GATES)).toEqual([...WHOLE_TREE_SWEEP].toSorted());
});

test("rejects a live tier with a moved suite filed back under e2e", () => {
  const e2e = readdirSync(resolve(import.meta.dir, "..", "..", "e2e"), { recursive: true, encoding: "utf8" }).map((path) => basename(path));
  for (const file of MOVED) {
    expect(existsSync(resolve(import.meta.dir, "..", "..", "live", file))).toBe(true);
    expect(e2e).not.toContain(file);
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
