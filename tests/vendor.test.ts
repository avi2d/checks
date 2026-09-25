import { expect, test } from "bun:test";
import { remoteSegments, resolveTag, tagFor } from "../scripts/vendor.ts";

test("tagFor fills the version token", () => {
  expect(tagFor("effect@{version}", "4.0.0-rc.115")).toBe("effect@4.0.0-rc.115");
});

test("remoteSegments splits https remotes into host, owner, repo and tag path", () => {
  expect(remoteSegments("https://github.com/Effect-TS/effect.git")).toEqual(["github.com", "Effect-TS", "effect"]);
});

test("remoteSegments splits scp-like remotes the same way", () => {
  expect(remoteSegments("git@github.com:Effect-TS/effect.git")).toEqual(["github.com", "Effect-TS", "effect"]);
});

test("remoteSegments keeps subgroups of ssh remotes below the host", () => {
  expect(remoteSegments("ssh://git@example.com/group/sub/repo.git")).toEqual(["example.com", "group", "sub", "repo"]);
});

test("remoteSegments files a local path under local with its separators escaped", () => {
  expect(remoteSegments("/tmp/checks-vendor-remote.git")).toEqual(["local", "_tmp_checks-vendor-remote.git"]);
  expect(remoteSegments("/tmp/checks-vendor-remote.git")).not.toEqual(remoteSegments("/tmp/checks_vendor_remote.git"));
});

test("resolveTag prefers the peeled commit of an annotated tag", () => {
  const output = "aaa00000000000000000000000000000000000000\trefs/tags/fake-lib@1.0.0\nbbb00000000000000000000000000000000000000\trefs/tags/fake-lib@1.0.0^{}\n";
  expect(resolveTag(output, "fake-lib@1.0.0")).toBe("bbb00000000000000000000000000000000000000");
});

test("resolveTag takes the plain line of a lightweight tag", () => {
  const output = "ccc00000000000000000000000000000000000000\trefs/tags/fake-lib@1.0.0\n";
  expect(resolveTag(output, "fake-lib@1.0.0")).toBe("ccc00000000000000000000000000000000000000");
});

test("resolveTag ignores a longer tag the glob also lists", () => {
  const output = "ddd00000000000000000000000000000000000000\trefs/tags/fake-lib@1.0.0-rc.1\nccc00000000000000000000000000000000000000\trefs/tags/fake-lib@1.0.0\n";
  expect(resolveTag(output, "fake-lib@1.0.0")).toBe("ccc00000000000000000000000000000000000000");
});

test("resolveTag misses another tag and an empty listing", () => {
  const output = "ddd00000000000000000000000000000000000000\trefs/tags/fake-lib@2.0.0\n";
  expect(resolveTag(output, "fake-lib@1.0.0")).toBeUndefined();
  expect(resolveTag("", "fake-lib@1.0.0")).toBeUndefined();
});
