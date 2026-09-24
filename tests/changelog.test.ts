import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { releaseDates, releases, renderChangelog, type Commit, type Cut } from "../scripts/changelog.ts";
import { judge } from "../scripts/doc-rules.ts";

function commits(...subjects: readonly string[]): readonly Commit[] {
  return subjects.map((subject, index) => ({ sha: `c${index}`, date: `2026-09-0${index + 1}`, subject }));
}

function cut(version: string, through: string, date = "2026-09-20"): Cut {
  return { version, through, date };
}

const HISTORY = commits(
  "chore: begin history",
  "feat: read a part's supplier (#2)",
  "fix(parts): keep the order of parts (#3)",
  "ci: run the suite on pull requests (#4)",
  "feat(bill)!: drop the legacy bill format (#5)",
  "Merge branch 'main' into topic",
  "perf(parts): index parts by supplier (#7)",
  "revert: read a part's supplier (#8)",
  "refactor(parts): split the reader (#9)",
  "feat(parts): price a bill (#10)",
);

test("a release lists its conventional commits under the template's groups, newest first, and leaves the rest out", () => {
  const rendered = renderChangelog("widget", releases(HISTORY, [cut("1.0.0", "c9")], undefined));
  expect(rendered).toBe(
    [
      "# Changelog",
      "",
      "Every release of `widget`, newest first, written by the release from its conventional commits.",
      "",
      "## 1.0.0",
      "",
      "Released 2026-09-20.",
      "",
      "### Breaking changes",
      "",
      "- **bill:** drop the legacy bill format (#5)",
      "",
      "### Features",
      "",
      "- **parts:** price a bill (#10)",
      "- read a part's supplier (#2)",
      "",
      "### Fixes",
      "",
      "- **parts:** keep the order of parts (#3)",
      "",
      "### Performance",
      "",
      "- **parts:** index parts by supplier (#7)",
      "",
      "### Reverts",
      "",
      "- read a part's supplier (#8)",
      "",
    ].join("\n"),
  );
});

test("each tag closes a release at its commit, so a version never tagged rolls into the next one", () => {
  const found = releases(HISTORY, [cut("0.2.0", "c6"), cut("0.1.0", "c2")], undefined);
  expect(found.map(({ version, subjects }) => ({ version, subjects }))).toEqual([
    { version: "0.2.0", subjects: HISTORY.slice(3, 7).map(({ subject }) => subject).toReversed() },
    { version: "0.1.0", subjects: HISTORY.slice(0, 3).map(({ subject }) => subject).toReversed() },
  ]);
});

test("the version no tag carries yet closes where package.json took it on, and later commits wait for the next release", () => {
  const found = releases(HISTORY, [cut("0.1.0", "c2")], cut("0.2.0", "c4"));
  expect(found.map(({ version, subjects }) => ({ version, subjects }))).toEqual([
    { version: "0.2.0", subjects: HISTORY.slice(3, 5).map(({ subject }) => subject).toReversed() },
    { version: "0.1.0", subjects: HISTORY.slice(0, 3).map(({ subject }) => subject).toReversed() },
  ]);
});

test("a version bumped in the working tree over a tagged head is a release holding nothing yet", () => {
  const found = releases(HISTORY, [cut("0.1.0", "c9")], cut("0.2.0", "c9"));
  expect(found.map(({ version, subjects }) => ({ version, subjects }))).toEqual([
    { version: "0.2.0", subjects: [] },
    { version: "0.1.0", subjects: HISTORY.map(({ subject }) => subject).toReversed() },
  ]);
});

test("a release with no conventional commit worth listing is its heading and its date", () => {
  const rendered = renderChangelog("widget", releases(commits("chore: tidy", "docs: say why"), [cut("0.1.0", "c1")], undefined));
  expect(rendered.split("\n").slice(4)).toEqual(["## 0.1.0", "", "Released 2026-09-20.", ""]);
});

test("the dates a changelog already carries read back by version, so regenerating it keeps them", () => {
  const rendered = renderChangelog("widget", [
    { version: "0.2.0", date: "2026-09-21", subjects: ["feat: price a bill"] },
    { version: "0.1.0", date: "2026-09-02", subjects: [] },
  ]);
  expect([...releaseDates(rendered)]).toEqual([
    ["0.2.0", "2026-09-21"],
    ["0.1.0", "2026-09-02"],
  ]);
});

test("the package ships CHANGELOG.md, which npm leaves out unless files names it", () => {
  const manifest: unknown = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "package.json"), "utf8"));
  expect(manifest).toHaveProperty("files", expect.arrayContaining(["CHANGELOG.md"]));
});

test("a rendered changelog holds to the changelog template checks-docs holds it to", () => {
  const rendered = renderChangelog("widget", releases(HISTORY, [cut("0.2.0", "c9"), cut("0.1.0", "c2", "2026-09-03")], undefined));
  expect(judge("changelog", { path: "CHANGELOG.md", text: rendered }, [])).toEqual([]);
});
