import { expect, test } from "bun:test";
import { cuts, releaseDates, renderChangelog, type Bump } from "../scripts/changelog.ts";
import { judge } from "../scripts/doc-rules.ts";

const SUBJECTS = [
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
].toReversed();

function bumps(...versions: readonly string[]): readonly Bump[] {
  return versions.map((version, index) => ({ sha: `c${index}`, version, date: `2026-09-0${index + 1}` }));
}

function recorded(...versions: readonly string[]): ReadonlyMap<string, string> {
  return new Map(versions.map((version) => [version, "2026-09-20"]));
}

test("a release lists its conventional commits under the template's groups, newest first, and leaves the rest out", () => {
  const rendered = renderChangelog("widget", [{ version: "1.0.0", date: "2026-09-20", subjects: SUBJECTS }], "https://github.com/acme/widget");
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
      "- **bill:** drop the legacy bill format [#5](https://github.com/acme/widget/pull/5)",
      "",
      "### Features",
      "",
      "- **parts:** price a bill [#10](https://github.com/acme/widget/pull/10)",
      "- read a part's supplier [#2](https://github.com/acme/widget/pull/2)",
      "",
      "### Fixes",
      "",
      "- **parts:** keep the order of parts [#3](https://github.com/acme/widget/pull/3)",
      "",
      "### Performance",
      "",
      "- **parts:** index parts by supplier [#7](https://github.com/acme/widget/pull/7)",
      "",
      "### Reverts",
      "",
      "- read a part's supplier [#8](https://github.com/acme/widget/pull/8)",
      "",
    ].join("\n"),
  );
});

test("every version bump closes a release when there is no changelog yet", () => {
  expect(cuts(bumps("0.1.0", "0.2.0", "0.3.0"), new Map(), new Set(), undefined)).toEqual([
    { version: "0.1.0", date: "2026-09-01", through: "c0", after: [] },
    { version: "0.2.0", date: "2026-09-02", through: "c1", after: ["c0"] },
    { version: "0.3.0", date: "2026-09-03", through: "c2", after: ["c0", "c1"] },
  ]);
});

test("a version older than the newest the changelog lists and absent from it rolls into the next release", () => {
  expect(cuts(bumps("0.1.0", "0.2.0", "0.3.0"), recorded("0.3.0", "0.1.0"), new Set(), undefined)).toEqual([
    { version: "0.1.0", date: "2026-09-20", through: "c0", after: [] },
    { version: "0.3.0", date: "2026-09-20", through: "c2", after: ["c0"] },
  ]);
});

test("the newest version bump is a release even when the changelog lists a newer version without it", () => {
  const found = cuts(bumps("0.1.0", "0.2.0"), recorded("0.3.0"), new Set(), undefined);
  expect(found.map(({ version, after }) => ({ version, after }))).toEqual([{ version: "0.2.0", after: [] }]);
});

test("a bump not newer than the release before it is a revert that cancels the unpublished releases above it", () => {
  const found = cuts(bumps("0.1.0", "0.2.0", "0.3.0", "0.2.0", "0.3.0"), recorded("0.2.0", "0.1.0"), new Set(), undefined);
  expect(found.map(({ version, through, after }) => ({ version, through, after }))).toEqual([
    { version: "0.1.0", through: "c0", after: [] },
    { version: "0.2.0", through: "c1", after: ["c0"] },
    { version: "0.3.0", through: "c4", after: ["c0", "c1"] },
  ]);
});

test("a revert keeps a tagged release, which was published", () => {
  const found = cuts(bumps("0.1.0", "0.2.0", "0.3.0", "0.2.0", "0.4.0"), recorded("0.3.0", "0.2.0", "0.1.0"), new Set(["0.3.0"]), undefined);
  expect(found.map(({ version }) => version)).toEqual(["0.1.0", "0.2.0", "0.3.0", "0.4.0"]);
});

test("a release keeps the date the changelog gives it, else its bump's date", () => {
  const found = cuts(bumps("0.1.0", "0.2.0"), new Map([["0.1.0", "2026-09-15"]]), new Set(), undefined);
  expect(found.map(({ version, date }) => ({ version, date }))).toEqual([
    { version: "0.1.0", date: "2026-09-15" },
    { version: "0.2.0", date: "2026-09-02" },
  ]);
});

test("the release being prepared covers everything past every release and keeps a date the changelog already gives it", () => {
  const prepared = { sha: "HEAD", version: "0.3.0", date: "2026-09-25" };
  expect(cuts(bumps("0.1.0", "0.2.0"), recorded("0.2.0", "0.1.0"), new Set(), prepared).at(-1)).toEqual({
    version: "0.3.0",
    date: "2026-09-25",
    through: "HEAD",
    after: ["c0", "c1"],
  });
  expect(cuts(bumps("0.1.0"), recorded("0.3.0", "0.1.0"), new Set(), prepared).at(-1)?.date).toBe("2026-09-20");
});

test("a release with no conventional commit worth listing is its heading and its date", () => {
  const rendered = renderChangelog("widget", [{ version: "0.1.0", date: "2026-09-20", subjects: ["docs: say why", "chore: tidy"] }], "https://github.com/acme/widget");
  expect(rendered.split("\n").slice(4)).toEqual(["## 0.1.0", "", "Released 2026-09-20.", ""]);
});

test("the dates a changelog already carries read back by version, so regenerating it keeps them", () => {
  const rendered = renderChangelog(
    "widget",
    [
      { version: "0.2.0", date: "2026-09-21", subjects: ["feat: price a bill"] },
      { version: "0.1.0", date: "2026-09-02", subjects: [] },
    ],
    "https://github.com/acme/widget",
  );
  expect([...releaseDates(rendered)]).toEqual([
    ["0.2.0", "2026-09-21"],
    ["0.1.0", "2026-09-02"],
  ]);
});

test("a rendered changelog holds to the changelog template checks-docs holds it to", () => {
  const rendered = renderChangelog(
    "widget",
    [
      { version: "0.2.0", date: "2026-09-20", subjects: SUBJECTS.slice(0, 7) },
      { version: "0.1.0", date: "2026-09-03", subjects: SUBJECTS.slice(7) },
    ],
    "https://github.com/acme/widget",
  );
  expect(judge("changelog", { path: "CHANGELOG.md", text: rendered }, [])).toEqual([]);
});
