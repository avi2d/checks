import { expect, test } from "bun:test";
import { groupOf } from "../../scripts/changelog.ts";
import { formatReport, unreleasedOf } from "../../scripts/release-report.ts";

test("only the changelog groups count as unreleased", () => {
  expect(
    unreleasedOf([
      "feat: price a bill (#4)",
      "fix(parts): keep the order of parts (#3)",
      "feat(bill)!: drop the legacy bill format (#5)",
      "perf(parts): index parts by supplier (#7)",
      "revert: read a part's supplier (#8)",
      "docs: say why",
      "chore: tidy",
      "Merge branch 'main' into topic",
    ]),
  ).toEqual([
    "feat: price a bill (#4)",
    "fix(parts): keep the order of parts (#3)",
    "feat(bill)!: drop the legacy bill format (#5)",
    "perf(parts): index parts by supplier (#7)",
    "revert: read a part's supplier (#8)",
  ]);
});

test("a breaking change counts even when its type never releases on its own", () => {
  expect(groupOf("ci(bill)!: drop the legacy bill format (#5)")).toBe("Breaking changes");
  expect(unreleasedOf(["ci(bill)!: drop the legacy bill format (#5)"])).toEqual(["ci(bill)!: drop the legacy bill format (#5)"]);
});

test("the report names the tag and each unreleased subject", () => {
  expect(formatReport(["feat: price a bill (#4)", "fix: keep the order (#3)"], "v0.1.0")).toBe(
    ["release-report: 2 unreleased change(s) since v0.1.0:", "  feat: price a bill (#4)", "  fix: keep the order (#3)"].join("\n"),
  );
});

test("the report names the lack of a tag and the lack of changes", () => {
  expect(formatReport(["feat: price a bill (#4)"], undefined)).toBe(
    ["release-report: 1 unreleased change(s) with no tag yet:", "  feat: price a bill (#4)"].join("\n"),
  );
  expect(formatReport([], "v0.1.0")).toBe("release-report: no unreleased changes since v0.1.0");
  expect(formatReport([], undefined)).toBe("release-report: no unreleased changes with no tag yet");
});
