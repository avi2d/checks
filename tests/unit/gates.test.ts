import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ENTRY_POINT, KIT_GATES, TEST_ENTRY_POINT } from "../../src/core/gates.ts";

const OUTSIDE_LINT = {
  "checks-changelog": "src/delivery/changelog-write.ts",
  "checks-release-notes": "src/delivery/release-notes.ts",
  "checks-release-report": "src/delivery/release-report.ts",
  "checks-mutation": "src/testing/mutation.ts",
  "checks-mutation-compare": "src/testing/mutation-compare.ts",
  "checks-subsumed-tests": "src/testing/subsumed-tests.ts",
  "checks-flake": "src/testing/flake.ts",
  "checks-vendor": "src/dependencies/vendor.ts",
};

test("every bin is an entry point, a gate the lint entry point runs, or a tool outside lint", () => {
  const manifest: unknown = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "..", "package.json"), "utf8"));
  const run = [
    ...[ENTRY_POINT, TEST_ENTRY_POINT].map(({ bin, script }) => [bin, `src/${script}`]),
    ...KIT_GATES.map(({ bin, vector, file }) => [bin, `src/${vector}/${file}`]),
  ];
  expect(manifest).toHaveProperty("bin", { ...Object.fromEntries(run), ...OUTSIDE_LINT });
});
