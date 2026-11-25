import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import manifest from "../../../package.json";
import { ENTRY_POINT, KIT_GATES, TEST_ENTRY_POINT } from "../../../src/core/gates.ts";

const OUTSIDE_LINT = {
  "checks-changelog": "dist/bin/delivery/changelog-write.ts",
  "checks-release-notes": "dist/bin/delivery/release-notes.ts",
  "checks-release-report": "dist/bin/delivery/release-report.ts",
  "checks-release-pr": "dist/bin/delivery/release-pr.ts",
  "checks-release-preflight": "dist/bin/delivery/release-preflight.ts",
  "checks-release-publish": "dist/bin/delivery/release-publish.ts",
  "checks-release-tag": "dist/bin/delivery/release-tag.ts",
  "checks-production-gate": "dist/bin/delivery/production-gate.ts",
  "checks-commit-title": "dist/bin/delivery/commit-title.ts",
  "checks-pr-text": "dist/bin/delivery/pr-text.ts",
  "checks-docs-only": "dist/bin/delivery/docs-only.ts",
  "checks-setup": "dist/bin/delivery/setup.ts",
  "checks-workflows": "dist/bin/delivery/workflows.ts",
  "checks-ci": "dist/bin/delivery/ci/main.ts",
  "checks-mutation": "dist/bin/testing/mutation.ts",
  "checks-mutation-compare": "dist/bin/testing/mutation-compare.ts",
  "checks-mutation-baseline": "dist/bin/testing/mutation-baseline.ts",
  "checks-mutation-scope": "dist/bin/testing/mutation-scope.ts",
  "checks-mutation-merge": "dist/bin/testing/mutation-merge.ts",
  "checks-subsumed-tests": "dist/bin/testing/subsumed-tests.ts",
  "checks-whole-tree-run": "dist/bin/testing/whole-tree-run.ts",
  "checks-flake": "dist/bin/testing/flake.ts",
  "checks-local-tests": "dist/bin/testing/local-tests-command.ts",
  "checks-vendor": "dist/bin/dependencies/vendor.ts",
  "checks-browser": "dist/bin/quality/browser/browser.ts",
  "checks-adr-index": "dist/bin/docs/adr-index.ts",
};

test("every bin is an entry point, a gate the lint entry point runs, or a tool outside lint", () => {
  const run = [
    ...[ENTRY_POINT, TEST_ENTRY_POINT].map(({ bin, script }) => [bin, `dist/bin/${script}`]),
    ...KIT_GATES.map(({ bin, vector, file }) => [bin, file.endsWith(".sh") ? `src/${vector}/${file}` : `dist/bin/${vector}/${file}`]),
  ];
  expect(manifest).toHaveProperty("bin", { ...Object.fromEntries(run), ...OUTSIDE_LINT });
});

test("every dist/bin launcher exists beside a src file of the same path, so no launcher points at a moved source", () => {
  const root = resolve(import.meta.dir, "..", "..", "..");
  const launchers = Object.values(manifest.bin).filter((target) => target.startsWith("dist/bin/"));
  expect(launchers.length).toBeGreaterThan(0);
  const unmatched = launchers.filter((launcher) => !existsSync(resolve(root, launcher)) || !existsSync(resolve(root, "src", launcher.slice("dist/bin/".length))));
  expect(unmatched).toEqual([]);
});
