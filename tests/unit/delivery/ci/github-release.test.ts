import { expect, test } from "bun:test";
import { highestTag, releaseCall, type ReleaseCall } from "../../../../src/delivery/ci/github-release.ts";

test.each([
  ["v1.10.0 ordered as text below v1.9.9", ["v1.2.0", "v1.10.0", "v1.9.9"], "v1.10.0"],
  ["a release candidate of a higher version ordered below it", ["v1.9.0", "v2.0.0-rc.1"], "v2.0.0-rc.1"],
  ["a tag that is no v-version counted", ["v9", "latest", "v1.0.0", "1.5.0"], "v1.0.0"],
])("%s fails", (_, tags, highest) => {
  expect(highestTag(tags)).toBe(highest);
});

test("tags none of which is a v-version that name a highest fails", () => {
  expect(highestTag(["latest", "nightly"])).toBeUndefined();
});

const released = [
  { id: 11, tag_name: "v1.0.0" },
  { id: 12, tag_name: "v1.1.0" },
];

const body = (tag: string, latest: "true" | "false"): ReleaseCall["body"] => ({ tag_name: tag, name: tag, body: "notes", draft: false, prerelease: false, make_latest: latest });

test("a new highest tag that updates a release or is left off latest fails", () => {
  expect(releaseCall(released, "v1.2.0", "notes")).toEqual({ method: "POST", path: "/releases", body: body("v1.2.0", "true") });
});

test("a tag that already has a release created twice fails", () => {
  expect(releaseCall(released, "v1.1.0", "notes")).toEqual({ method: "PATCH", path: "/releases/12", body: body("v1.1.0", "true") });
});

test("a tag below the highest release marked latest fails", () => {
  expect(releaseCall(released, "v1.0.1", "notes")).toEqual({ method: "POST", path: "/releases", body: body("v1.0.1", "false") });
  expect(releaseCall(released, "v1.0.0", "notes")).toEqual({ method: "PATCH", path: "/releases/11", body: body("v1.0.0", "false") });
});
