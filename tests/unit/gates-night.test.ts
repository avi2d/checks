import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { KIT_GATES, NIGHT_GATES, PR_GATES } from "../../src/core/gates.ts";

const RETIRED = [
  "checks-lint-coverage",
  "checks-quarantine-clock",
  "checks-suppressions-ratchet",
  "checks-repetition",
] as const;

const WATCH_LIST = ["checks-secrets", "checks-unused", "checks-exports", "checks-imports"] as const;

const binsOf = (gates: readonly { readonly bin: string }[]): readonly string[] => gates.map(({ bin }) => bin).toSorted();

test("retiring gates to the night run never skips secrets, unused, exports or imports on a per-PR run", () => {
  expect(binsOf(NIGHT_GATES)).toEqual([...RETIRED].toSorted());
  expect(binsOf(PR_GATES)).toEqual(binsOf(KIT_GATES).filter((bin) => !(RETIRED as readonly string[]).includes(bin)));
  for (const bin of WATCH_LIST) expect(PR_GATES.some((gate) => gate.bin === bin)).toBe(true);
  for (const bin of RETIRED) expect(PR_GATES.some((gate) => gate.bin === bin)).toBe(false);
});

test("the night-run workflow runs the retired gates and the live tier instead of the per-PR workflow", () => {
  const workflow = readFileSync(resolve(import.meta.dir, "..", "..", ".github/workflows/night-run.yml"), "utf8");
  expect(workflow).toContain("bun src/core/lint.ts --night");
  expect(workflow).toContain("--tier=live");
});

test("the stryker-consumer and browser suites run in the live tier rather than the per-PR e2e tier", () => {
  const moved = ["browser.test.ts", "stryker-consumer.test.ts", "stryker-consumer-config.test.ts", "stryker-consumer-runtime-read.test.ts"];
  expect(moved.map((name) => readdirSync(resolve(import.meta.dir, "..", "live")).includes(name))).toEqual([true, true, true, true]);
  const stayed = readdirSync(resolve(import.meta.dir, "..", "e2e")).filter(
    (name) => name === "browser.test.ts" || (name.startsWith("stryker-consumer") && name.endsWith(".test.ts")),
  );
  expect(stayed).toEqual([]);
});
