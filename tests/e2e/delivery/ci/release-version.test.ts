import { expect, test } from "bun:test";
import { runCi, useScratch } from "../../lib/ci-command.ts";

const scratch = useScratch("release-version");

function match(manifest: string, tag: string) {
  scratch.write("package.json", manifest);
  return runCi("release-version", [], { PATH: process.env["PATH"] ?? "", GITHUB_OUTPUT: scratch.at("output"), PACKAGE_PATH: "./package.json", TAG: tag }, scratch.at());
}

test("a tag that names the manifest version refused, or its version left off the output, fails", async () => {
  const ran = await match('{"name":"kit","version":"1.2.3"}', "v1.2.3");
  expect(ran.exitCode).toBe(0);
  expect(scratch.read("output")).toBe("version=1.2.3\n");
});

test.each([["v1.2.4"], ["1.2.3"], ["v1.2.3-rc.1"]])("the tag %p over a 1.2.3 manifest that passes fails", async (tag) => {
  const ran = await match('{"name":"kit","version":"1.2.3"}', tag);
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain(`::error::the tag is ${tag}, where ./package.json holds 1.2.3 and wants v1.2.3`);
  expect(scratch.read("output")).toBe("");
});

test.each([['{"name":"kit"}'], ['{"version":7}'], ['{"version":""}'], ["not json"]])("the manifest %p read as a version passes", async (manifest) => {
  const ran = await match(manifest, "v");
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::./package.json holds");
  expect(scratch.read("output")).toBe("");
});

test("a missing manifest that passes fails", async () => {
  const ran = await runCi("release-version", [], { PATH: process.env["PATH"] ?? "", GITHUB_OUTPUT: scratch.at("output"), PACKAGE_PATH: "./nope.json", TAG: "v1.0.0" }, scratch.at());
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::release-version cannot read ./nope.json");
});

test("an empty tag that passes fails", async () => {
  const ran = await match('{"version":"1.2.3"}', "");
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::release-version needs the tag input, and it is empty");
});
