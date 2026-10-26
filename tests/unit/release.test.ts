import { expect, test } from "bun:test";
import { groupOf } from "../../src/delivery/changelog.ts";
import { nextVersion, releasedVersionOf, releaseTitle, unreleasedOf, withVersion } from "../../src/delivery/release.ts";

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

test("below 1.0 a feature or a breaking change moves the minor, and anything else the patch", () => {
  expect(nextVersion("0.30.0", ["feat: lint .astro files (#108)"])).toBe("0.31.0");
  expect(nextVersion("0.28.0", ["feat(docs)!: hold agent files to a router (#101)", "fix(testing): run with CI=true (#100)"])).toBe("0.29.0");
  expect(nextVersion("0.24.0", ["fix(scripts): release a late version (#79)"])).toBe("0.24.1");
  expect(nextVersion("0.24.1", ["perf: index parts (#7)", "revert: read a supplier (#8)"])).toBe("0.24.2");
});

test("from 1.0 a breaking change moves the major, a feature the minor and anything else the patch", () => {
  expect(nextVersion("1.4.2", ["fix: keep the order (#3)", "feat!: drop the legacy format (#5)"])).toBe("2.0.0");
  expect(nextVersion("1.4.2", ["fix: keep the order (#3)", "feat: price a bill (#4)"])).toBe("1.5.0");
  expect(nextVersion("1.4.2", ["fix: keep the order (#3)"])).toBe("1.4.3");
});

test("a version that is no plain major.minor.patch has no next version", () => {
  expect(nextVersion("1.0.0-rc.1", ["fix: keep the order (#3)"])).toBeUndefined();
  expect(nextVersion("v1.0.0", ["fix: keep the order (#3)"])).toBeUndefined();
  expect(nextVersion("1.0", ["fix: keep the order (#3)"])).toBeUndefined();
});

test("the bump rewrites the version's text and leaves the manifest's own formatting", () => {
  const manifest = '{\n    "name": "widget",\n    "version":"0.1.0",\n    "files": ["src/"]\n}\n';
  expect(withVersion(manifest, "0.1.0", "0.2.0")).toBe('{\n    "name": "widget",\n    "version":"0.2.0",\n    "files": ["src/"]\n}\n');
  expect(withVersion('{ "version": "0.1.0" }', "0.1.0", "0.1.1")).toBe('{ "version": "0.1.1" }');
  expect(withVersion('{ "version": "0x1x0" }', "0.1.0", "0.2.0")).toBeUndefined();
  expect(withVersion('{ "name": "widget" }', "0.1.0", "0.2.0")).toBeUndefined();
});

test("a release subject names its version, whether or not the squash merge added the pull request", () => {
  expect(releaseTitle("0.32.0")).toBe("chore: release 0.32.0");
  expect(releasedVersionOf("chore: release 0.32.0")).toBe("0.32.0");
  expect(releasedVersionOf("chore: release 0.31.0 (#109)")).toBe("0.31.0");
  expect(releasedVersionOf("chore(deps): release 0.32.0")).toBeUndefined();
  expect(releasedVersionOf("chore: release 0.32.0 and more")).toBeUndefined();
  expect(releasedVersionOf("feat: release 0.32.0")).toBeUndefined();
});
