import { expect, test } from "bun:test";
import { formatReport } from "../../src/delivery/release-report.ts";

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
