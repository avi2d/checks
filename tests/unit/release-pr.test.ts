import { expect, test } from "bun:test";
import { releaseBranchOf, stagedOf } from "../../src/delivery/release-pr.ts";

const ZERO = "0".repeat(40);
const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

test("the staged diff gives each written file its new mode and each deleted file its old one", () => {
  const raw = [
    `:100644 100644 ${OLD} ${NEW} M`,
    "CHANGELOG.md",
    `:000000 100755 ${ZERO} ${NEW} A`,
    "bin/run me.sh",
    `:100644 000000 ${OLD} ${ZERO} D`,
    "dist/stale.js",
    "",
  ].join("\0");
  expect(stagedOf(raw)).toEqual([
    { kind: "written", path: "CHANGELOG.md", mode: "100644" },
    { kind: "written", path: "bin/run me.sh", mode: "100755" },
    { kind: "deleted", path: "dist/stale.js", mode: "100644" },
  ]);
  expect(stagedOf("")).toEqual([]);
});

test("the release branch names the branch it releases", () => {
  expect(releaseBranchOf("main")).toBe("release/main");
  expect(releaseBranchOf("fm/topic")).toBe("release/fm/topic");
});
