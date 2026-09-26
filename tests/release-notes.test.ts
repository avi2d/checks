import { Effect } from "effect";
import { expect, test } from "bun:test";
import { extractReleaseNotes } from "../scripts/release-notes.ts";

test("release notes contain only the requested section with outer blank lines trimmed", () => {
  const changelog = [
    "# Changelog",
    "",
    "## 0.22.0",
    "",
    "Released 2026-09-27.",
    "",
    "### Features",
    "",
    "- Add a release [#67](https://github.com/avi2d/checks/pull/67)",
    "",
    "## 0.21.0",
    "",
    "older release",
  ].join("\n");

  expect(Effect.runSync(extractReleaseNotes(changelog, "0.22.0"))).toBe(
    [
      "Released 2026-09-27.",
      "",
      "### Features",
      "",
      "- Add a release [#67](https://github.com/avi2d/checks/pull/67)",
    ].join("\n"),
  );
});

test("a missing release section fails", () => {
  expect(() => Effect.runSync(extractReleaseNotes("# Changelog\n", "0.22.0"))).toThrow("CHANGELOG.md has no section for 0.22.0");
});

test("an empty release section fails", () => {
  expect(() => Effect.runSync(extractReleaseNotes("# Changelog\n\n## 0.22.0\n\n## 0.21.0\n", "0.22.0"))).toThrow("CHANGELOG.md has an empty section for 0.22.0");
});
